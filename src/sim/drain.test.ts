import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode } from "../model/types";
import gcp from "../examples/gcp-streaming-analytics.json";
import { analyzeCapacity } from "./capacity";
import { createEngine } from "./engine";
import { DEFAULT_TRAVEL_MS } from "./topology";
import { GROWTH_FACTOR } from "../test/complexity";

// A consumer behind a broker drains at the rate capacity analysis reports: its slots are taken when a delivery
// arrives, not while it travels (docs/research/sim-flows-review.md, F-1). Seeded runs, compared as ratios and
// counts, never as milliseconds.

const node = (id: string, stencil: string, props?: Record<string, unknown>): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  ...(props ? { props } : {}),
});
const edge = (from: string, to: string, props?: Record<string, unknown>): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "async",
  ...(props ? { props } : {}),
});

/** Producer at `rate` msg/s → broker → a consumer with default sizing (250 ms × 4 = 16 msg/s), all defaults. */
function brokerFed(broker: string, rate: number, consumer?: Record<string, unknown>, hop?: Record<string, unknown>) {
  return {
    format: "diagrams/v1",
    title: "Broker-fed consumer",
    nodes: [
      node("checkout", "client.browser", { ratePerSec: rate }),
      node("broker", broker),
      node("billing", "service.dotnet", consumer),
    ],
    edges: [edge("checkout", "broker"), edge("broker", "billing", hop)],
  } satisfies DiagramFile;
}

/** Free play for `seconds` (after a warm-up), then the consumer's processed rate and the broker's lag. */
function play(d: DiagramFile, seconds: number, scale = 1) {
  const engine = createEngine({ seed: 1 });
  engine.load(d);
  engine.setScale(scale);
  engine.setTraffic(true);
  const lag = () => Math.max(0, ...Object.values(engine.frame().nodes.broker.lag)) * scale;
  for (let t = 0; t < 10_000; t += 100) engine.step(100);
  const start = engine.frame().nodes.billing.processed * scale;
  const lagBefore = lag();
  for (let t = 0; t < seconds * 1000; t += 100) engine.step(100);
  return {
    rate: (engine.frame().nodes.billing.processed * scale - start) / seconds,
    lagBefore,
    lagAfter: lag(),
    consumerBacklog: engine.frame().nodes.billing.backlog,
  };
}

describe("broker-fed consumers drain at their reported capacity", () => {
  it("defaults to 300 ms for a message and 200 ms for a request", () => {
    expect(DEFAULT_TRAVEL_MS).toEqual({ async: 300, sync: 200 });
  });

  it.each(["kafka.topic", "aws.sqs"])("a default consumer behind %s keeps up at 6/s: no lag builds", (broker) => {
    const d = brokerFed(broker, 6);
    expect(analyzeCapacity(d).nodes.billing.utilization).toBeCloseTo(6 / 16);
    const run = play(d, 30);
    expect(run.rate / 6).toBeGreaterThan(0.97);
    expect(run.lagAfter).toBeLessThanOrEqual(2);
  });

  it.each([
    ["kafka.topic", 300],
    ["kafka.topic", 900],
    ["aws.sqs", 3000],
  ])("overloaded behind %s with %d ms of travel, it drains at its capacity", (broker, travelMs) => {
    const d = brokerFed(broker, 40, undefined, { travelMs });
    const capacity = analyzeCapacity(d).nodes.billing.capacity;
    const run = play(d, 30);
    // Jitter and the 10 ms tick cost a few percent, as they do for a consumer fed directly.
    expect(run.rate / capacity).toBeGreaterThan(0.95);
    expect(run.rate / capacity).toBeLessThan(1.01);
    expect(run.lagAfter).toBeGreaterThan(run.lagBefore);
  });

  it("without jitter the drain rate is exactly the capacity", () => {
    const d = brokerFed("kafka.topic", 40, { jitter: 0 }, { travelMs: 900 });
    const run = play(d, 30);
    expect(run.rate).toBeCloseTo(analyzeCapacity(d).nodes.billing.capacity, 5);
  });

  it("at a sampling scale the backlog stays at the broker, not hidden at the consumer", () => {
    const d = brokerFed("kafka.topic", 600, { replicas: 3 }, { travelMs: 900 });
    // Partitions (3) × 4 slots at 250 ms: 48 msg/s, at 20 messages a dot.
    const capacity = analyzeCapacity(d).nodes.billing.capacity;
    const run = play(d, 30, 20);
    expect(run.rate / capacity).toBeGreaterThan(0.95);
    expect(run.lagAfter - run.lagBefore).toBeGreaterThan(0.9 * (600 - capacity) * 30);
    // 12 slots ÷ 20 per dot, plus what keeps them fed over 900 ms, plus one: a handful of dots, never the lag.
    expect(run.consumerBacklog).toBeLessThanOrEqual(4);
  });

  it("deliveries staged behind a group's partitions survive a checkpoint, seed for seed", () => {
    // One partition, a consumer with free slots from a direct input: topic deliveries wait their group's turn.
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Staged",
      nodes: [
        node("topic", "kafka.topic", { partitions: 1 }),
        node("api", "client.browser", { ratePerSec: 4 }),
        node("billing", "service.dotnet", { replicas: 3, concurrency: 1, latencyMs: 400 }),
      ],
      edges: [edge("topic", "billing", { travelMs: 900 }), edge("api", "billing")],
    };
    const engine = createEngine({ seed: 3 });
    engine.load(d);
    engine.setTraffic(true);
    engine.inject("topic", 30);
    engine.step(1_000);
    const checkpoint = engine.checkpoint();
    engine.step(5_000);
    const straight = engine.snapshot();
    engine.restore(checkpoint);
    engine.step(5_000);
    expect(engine.snapshot()).toEqual(straight);
    // The topic's group works one at a time: 400 ms each, so about 2.5 a second over these 5 s.
    expect(straight.edges["topic-billing"].delivered).toBeLessThanOrEqual(1 + 3 + 15);
  });

  it("the public GCP example's Pub/Sub topic doesn't fall behind at 13%", () => {
    const d = structuredClone(gcp) as DiagramFile;
    expect(analyzeCapacity(d).nodes["pubsub-topic"].utilization).toBeLessThan(0.2);
    const engine = createEngine({ seed: 1 });
    engine.load(d);
    engine.setTraffic(true);
    for (let t = 0; t < 60_000; t += 100) engine.step(100);
    const lag = engine.frame().nodes["pubsub-topic"].lag;
    expect(Math.max(...Object.values(lag))).toBeLessThanOrEqual(5);
  });
});

describe("staged deliveries cost nothing while they wait", () => {
  /** Engines with `n` deliveries staged at a consumer whose group has one slot: a burst prefetched at concurrency
   *  1,000 (10 ms each, 300 ms away), then concurrency cut to 1 before it arrives. */
  function staged(n: number) {
    const engine = createEngine({ seed: 1, maxParticles: 0 });
    engine.load({
      format: "diagrams/v1",
      title: "Staged",
      nodes: [
        node("broker", "kafka.topic", { partitions: 1 }),
        node("billing", "service.dotnet", { concurrency: 1000, latencyMs: 10, jitter: 0 }),
      ],
      edges: [edge("broker", "billing", { travelMs: 300 })],
    });
    engine.inject("broker", n);
    engine.step(10);
    engine.setNodeProps("billing", { concurrency: 1 });
    engine.step(400);
    return engine;
  }

  it("the backlog really is staged, and drains one slot at a time", () => {
    const engine = staged(2_000);
    expect(engine.frame().nodes.billing.backlog).toBeGreaterThan(1_900);
    const before = engine.frame().nodes.billing.processed;
    engine.step(1_000);
    // One slot, 10 ms each: about 100 in a second, never the whole backlog at once.
    expect(engine.frame().nodes.billing.processed - before).toBeLessThanOrEqual(101);
  });

  it("a tick's work doesn't grow with the staged backlog", () => {
    // Fresh engines per measurement (stepping changes them); the fastest of several, both sizes interleaved.
    const time = (n: number) => {
      const engine = staged(n);
      const start = performance.now();
      engine.step(500);
      return performance.now() - start;
    };
    let small = Infinity,
      large = Infinity;
    for (let i = 0; i < 5; i++) {
      small = Math.min(small, time(GROWTH_FACTOR * 250));
      large = Math.min(large, time(GROWTH_FACTOR * 2_000));
    }
    // A rescan of the backlog each tick grows with it (about 8× here); admitting only as slots free doesn't.
    expect(large / small).toBeLessThan(3);
  });
});

it("a 0 ms consumer is paced as one tick: a burst never pulls the whole backlog onto the edge", () => {
  const engine = createEngine({ seed: 1, maxParticles: 0 });
  engine.load({
    format: "diagrams/v1",
    title: "Zero",
    nodes: [
      node("broker", "kafka.topic", { partitions: 1 }),
      node("billing", "service.dotnet", { concurrency: 1, latencyMs: 0 }),
    ],
    edges: [edge("broker", "billing", { travelMs: 300 })],
  });
  engine.inject("broker", 100_000);
  engine.step(10);
  // 1 slot + ceil(1 × 300 / 10) on the way + 1.
  expect(engine.snapshot().edges["broker-billing"].active).toBe(32);
});

it("a deny rule in a topic's group takes no slot and stages nothing: the allowed consumer still drains at capacity", () => {
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "Deny",
    nodes: [
      node("checkout", "client.browser", { ratePerSec: 40 }),
      node("broker", "kafka.topic", { partitions: 1 }),
      node("billing", "service.dotnet"),
      node("audit", "service.go"),
    ],
    edges: [
      edge("checkout", "broker"),
      { ...edge("broker", "billing", { group: "g" }) },
      { ...edge("broker", "audit", { group: "g", deny: true }) },
    ],
  };
  const engine = createEngine({ seed: 1 });
  engine.load(d);
  engine.setTraffic(true);
  for (let t = 0; t < 10_000; t += 100) engine.step(100);
  const start = engine.frame().nodes.billing.processed;
  for (let t = 0; t < 30_000; t += 100) engine.step(100);
  const nodes = engine.snapshot().nodes;
  // The denied target never receives, holds or stages anything.
  expect(nodes.audit).toMatchObject({ processed: 0, inFlight: 0, backlog: 0 });
  expect(nodes.broker.blocked).toBeGreaterThan(0);
  // Half the round robin is blocked at once; the rest drains at billing's 16/s, or all of it if that's less.
  const rate = (nodes.billing.processed - start) / 30;
  expect(rate / analyzeCapacity(d).nodes.billing.capacity).toBeGreaterThan(0.95);
});
