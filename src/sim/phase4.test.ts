import { describe, expect, it, vi } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, SimRole, Simulation, TrafficShape } from "../model/types";
import { createEngine } from "./engine";
import { resolveProps } from "./defaults";
import { createSimulationRun, autoScale } from "./simulation";
import { realNodeMetrics, realSnapshot, toRealUnits, toSimulatedUnits } from "./units";

const node = (id: string, role: SimRole, props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil: role,
  label: id,
  x: 0,
  y: 0,
  props,
});
const edge = (from: string, to: string, props: Record<string, unknown> = {}, id = `${from}-${to}`): DiagramEdge => ({
  id,
  from,
  to,
  props: { travelMs: 10, ...props },
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[] = []): DiagramFile => ({
  format: "diagrams/v1",
  title: "Phase 4",
  nodes,
  edges,
});
const options = { seed: 123, roleOf: (id: string) => id as SimRole };
const engine = (d: DiagramFile) => {
  const e = createEngine(options);
  e.load(d);
  return e;
};
const simulation = (patch: Partial<Simulation> = {}): Simulation => ({
  id: "p4",
  title: "Phase 4",
  traffic: [],
  ...patch,
});

describe("replica assignments and parallelism", () => {
  it("multiplies processor concurrency and updates live without canceling active work", () => {
    const e = engine(diagram([node("p", "processor", { replicas: 3, concurrency: 2, latencyMs: 1000, jitter: 0 })]));
    e.inject("p", 20);
    e.step(10);
    expect(e.snapshot().nodes.p).toMatchObject({
      inFlight: 6,
      backlog: 14,
      replicas: 3,
      activeReplicas: 3,
      idleReplicas: 0,
    });
    e.setNodeProps("p", { replicas: 1 });
    e.step(10);
    expect(e.frame().nodes.p.inFlight).toBe(6);
    e.step(1000);
    expect(e.frame().nodes.p.inFlight).toBe(2);
    e.setNodeProps("p", { replicas: 4 });
    e.step(10);
    expect(e.frame().nodes.p.inFlight).toBe(8);
  });
  it.each(["topic", "stream"] as const)("%s caps replicas, not slots, independently for each group", (role) => {
    const e = engine(
      diagram(
        [
          node("b", role, { partitions: 3 }),
          node("a", "processor", { replicas: 6, concurrency: 2, latencyMs: 1000, jitter: 0 }),
          node("c", "processor", { replicas: 4, concurrency: 3, latencyMs: 1000, jitter: 0 }),
        ],
        [edge("b", "a", { group: "a" }), edge("b", "c", { group: "c" })],
      ),
    );
    e.inject("b", 30);
    e.step(30);
    expect(e.frame().nodes.a).toMatchObject({ activeReplicas: 3, idleReplicas: 3, inFlight: 6 });
    expect(e.frame().nodes.c).toMatchObject({ activeReplicas: 3, idleReplicas: 1, inFlight: 9 });
    e.setNodeProps("b", { partitions: 6 });
    e.step(30);
    expect(e.frame().nodes.a).toMatchObject({ activeReplicas: 6, idleReplicas: 0, inFlight: 12 });
  });
  it("shares one partition budget between group members, including duplicate edges", () => {
    const e = engine(
      diagram(
        [
          node("b", "topic", { partitions: 3 }),
          node("a", "processor", { replicas: 4, concurrency: 2, latencyMs: 1000 }),
          node("c", "processor", { replicas: 4, concurrency: 2, latencyMs: 1000 }),
        ],
        [edge("b", "a", { group: "g" }), edge("b", "a", { group: "g" }, "duplicate"), edge("b", "c", { group: "g" })],
      ),
    );
    e.inject("b", 100);
    e.step(30);
    expect(e.frame().nodes.a.activeReplicas! + e.frame().nodes.c.activeReplicas!).toBe(3);
    expect(e.frame().nodes.a.inFlight + e.frame().nodes.c.inFlight).toBe(6);
  });
  it("queues let all replicas compete and a push/queue input removes the global topic restriction", () => {
    const d = diagram(
      [node("b", "queue", { partitions: 1 }), node("p", "processor", { replicas: 6, concurrency: 2, latencyMs: 1000 })],
      [edge("b", "p")],
    );
    const e = engine(d);
    e.inject("b", 100);
    e.step(30);
    expect(e.frame().nodes.p).toMatchObject({ activeReplicas: 6, idleReplicas: 0, inFlight: 12 });
  });
  it("rounds capacity multipliers, clamps to one replica, and keeps base props intact", () => {
    const e = engine(diagram([node("p", "processor", { replicas: 3 })]));
    e.setCapacityMultiplier(1.5);
    expect(e.frame().nodes.p.replicas).toBe(5);
    expect(e.effectiveProps("p").replicas).toBe(3);
    e.setCapacityMultiplier(0);
    expect(e.frame().nodes.p.replicas).toBe(1);
    e.setCapacityMultiplier(NaN);
    expect(e.frame().nodes.p.replicas).toBe(1);
  });
});

describe("seeded jitter and probability shares", () => {
  it("defaults to 0.2, clamps malformed props, and resolves retry defaults", () => {
    expect(resolveProps("processor", "P", {})).toMatchObject({ jitter: 0.2, retry: "requeue", retryBackoffMs: 0 });
    expect(
      resolveProps("processor", "P", { jitter: 5, replicas: -2, retry: "invalid", retryBackoffMs: -2 }),
    ).toMatchObject({ jitter: 1, replicas: 1, retry: "requeue", retryBackoffMs: 0 });
  });
  it.each(["processor", "gateway", "store"] as const)(
    "%s latency varies within jitter bounds and repeats by seed",
    (role) => {
      const d = diagram([node("p", role, { latencyMs: 1000, concurrency: 100 })]);
      const first = engine(d),
        second = engine(d);
      for (const e of [first, second]) {
        e.inject("p", 60);
        e.step(1500);
      }
      expect(first.snapshot()).toEqual(second.snapshot());
      const times = first
        .snapshot()
        .events.filter((event) => event.kind === "process")
        .map((event) => event.time);
      expect(new Set(times).size).toBeGreaterThan(10);
      expect(Math.min(...times)).toBeGreaterThanOrEqual(810);
      expect(Math.max(...times)).toBeLessThanOrEqual(1210);
    },
  );
  it("explicit zero jitter keeps identical exact durations", () => {
    const e = engine(diagram([node("p", "processor", { latencyMs: 100, jitter: 0, concurrency: 4 })]));
    e.inject("p", 4);
    e.step(100);
    expect(e.frame().nodes.p.processed).toBe(0);
    e.step(10);
    expect(e.frame().nodes.p.processed).toBe(4);
  });
  it.each(["source", "processor", "store"] as const)(
    "%s fan-out applies independent seeded shares with zero/one endpoints",
    (role) => {
      const d = diagram(
        [
          node("s", role, { latencyMs: 0, concurrency: 10000 }),
          node("a", "sink"),
          node("b", "sink"),
          node("c", "sink"),
          node("d", "sink"),
        ],
        [edge("s", "a", { share: 0 }), edge("s", "b", { share: 1 }), edge("s", "c", { share: 0.35 }), edge("s", "d")],
      );
      const first = engine(d),
        second = engine(d);
      for (const e of [first, second]) {
        e.inject("s", 10000);
        e.step(100);
      }
      expect(first.snapshot()).toEqual(second.snapshot());
      expect(first.frame().nodes.a.processed).toBe(0);
      expect(first.frame().nodes.b.processed).toBe(10000);
      expect(first.frame().nodes.d.processed).toBe(10000);
      expect(first.frame().nodes.c.processed).toBeGreaterThan(3200);
      expect(first.frame().nodes.c.processed).toBeLessThan(3800);
      expect(first.metrics().inSystem).toBe(0);
    },
  );
  it("filters before probability selection and ignores share for competing routes", () => {
    const e = engine(
      diagram(
        [node("b", "queue"), node("p", "processor", { latencyMs: 0 }), node("s", "sink")],
        [edge("b", "p", { share: 0 }), edge("p", "s", { share: 1, filter: ["Other"] })],
      ),
    );
    e.inject("b", 10, { type: "Order" });
    e.step(1000);
    expect(e.frame().nodes.p.processed).toBe(10);
    expect(e.frame().nodes.s.processed).toBe(0);
    expect(e.metrics().inSystem).toBe(0);
  });
});

describe("engine gaps and rendering accessor", () => {
  it.each(["processor", "sink"] as const)("does not infer DLQ for a %s target", (role) => {
    const d = diagram(
      [node("q", "queue"), { ...node("p", role, { latencyMs: 0 }), sublabel: "no DLQ" }],
      [edge("q", "p")],
    );
    const e = engine(d);
    e.inject("q", 4);
    e.step(100);
    expect(e.frame().nodes.p.processed).toBe(4);
  });
  it.each(["queue", "store"] as const)("dlq:false disables inference for %s targets", (role) => {
    const e = engine(diagram([node("q", "queue"), node("dlq", role)], [edge("q", "dlq", { dlq: false })]));
    e.inject("q", 4);
    e.step(500);
    expect(e.frame().nodes.dlq.processed).toBe(4);
    expect(e.frame().nodes.q.deadLettered).toBe(0);
  });
  it("never infers DLQ on nonbroker output", () => {
    const e = engine(diagram([node("p", "processor", { latencyMs: 0 }), node("dlq", "store")], [edge("p", "dlq")]));
    e.inject("p", 3);
    e.step(500);
    expect(e.frame().nodes.dlq.processed).toBe(3);
  });
  it.each(["sink", "store"] as const)("injecting at a %s emits along outgoing edges, even sync", (role) => {
    const d = diagram([node("p", role), node("end", "sink")], [{ ...edge("p", "end"), kind: "sync" }]);
    const e = engine(d);
    e.inject("p", 3);
    e.step(500);
    expect(e.frame().nodes.end.processed).toBe(3);
    expect(e.metrics().inSystem).toBe(0);
  });
  it.each(["requeue", "inplace"] as const)("%s retries use backoff and exhaust into DLQ", (retry) => {
    const e = engine(
      diagram(
        [
          node("b", "queue", { maxDeliveryCount: 3 }),
          node("p", "processor", {
            retry,
            retryBackoffMs: 100,
            failureRate: 1,
            latencyMs: 20,
            concurrency: 1,
            jitter: 0,
          }),
          node("dlq", "store", { jitter: 0 }),
        ],
        [edge("b", "p"), edge("b", "dlq", { dlq: true })],
      ),
    );
    e.inject("b", 1);
    e.step(80);
    expect(e.frame().nodes.p.failed).toBe(1);
    expect(e.frame().nodes.p.inFlight).toBe(retry === "inplace" ? 1 : 0);
    e.step(1000);
    expect(e.frame().nodes.p.failed).toBe(3);
    expect(e.frame().nodes.b.deadLettered).toBe(1);
    expect(e.frame().nodes.dlq.processed).toBe(1);
    expect(e.metrics().inSystem).toBe(0);
  });
  it("in-place retry retains the same message/slot ahead of a long backlog and survives checkpoint", () => {
    const e = engine(
      diagram(
        [
          node("b", "topic", { partitions: 1, maxDeliveryCount: 2 }),
          node("p", "processor", {
            retry: "inplace",
            retryBackoffMs: 200,
            latencyMs: 20,
            jitter: 0,
            concurrency: 1,
            failureRate: 1,
          }),
          node("dlq", "store"),
        ],
        [edge("b", "p", { emits: "Command" }), edge("b", "dlq", { dlq: true })],
      ),
    );
    e.inject("b", 20, { type: "Order" });
    e.step(100);
    expect(e.frame().nodes.b.backlog).toBe(19);
    const checkpoint = e.checkpoint();
    e.step(250);
    const result = e.snapshot();
    expect(result.nodes.b.deadLettered).toBe(1);
    expect(result.events.find((event) => event.kind === "deadletter")?.text).toContain("Order #1");
    e.restore(checkpoint);
    e.step(250);
    expect(e.snapshot()).toEqual(result);
  });
  it("paused in-place retries freeze and can recover without releasing their slot", () => {
    const e = engine(
      diagram(
        [
          node("b", "queue"),
          node("p", "processor", { retry: "inplace", retryBackoffMs: 100, failureRate: 1, latencyMs: 10, jitter: 0 }),
        ],
        [edge("b", "p")],
      ),
    );
    e.inject("b", 1);
    e.step(40);
    e.setNodeStatus("p", "paused");
    e.step(500);
    expect(e.frame().nodes.p).toMatchObject({ failed: 1, inFlight: 1 });
    e.setNodeProps("p", { failureRate: 0 });
    e.setNodeStatus("p", "up");
    e.step(200);
    expect(e.frame().nodes.p.processed).toBe(1);
    expect(e.metrics().inSystem).toBe(0);
  });
  it("frame matches rendering state, has no log/edges, and returns detached arrays/metrics", () => {
    const e = engine(diagram([node("s", "source"), node("p", "processor")], [edge("s", "p", { travelMs: 100 })]));
    e.inject("s", 300);
    e.step(10);
    const snapshot = vi.spyOn(e, "snapshot");
    const frame = e.frame();
    expect(snapshot).not.toHaveBeenCalled();
    expect(frame).not.toHaveProperty("events");
    expect(frame).not.toHaveProperty("edges");
    const full = e.snapshot();
    expect(frame).toEqual({
      time: full.time,
      scale: full.scale,
      nodes: full.nodes,
      particles: full.particles,
      inSystem: full.inSystem,
    });
    frame.particles[0].progress = 42;
    frame.nodes.p.lag.fake = 99;
    expect(e.frame().particles[0].progress).not.toBe(42);
    expect(e.frame().nodes.p.lag).not.toHaveProperty("fake");
    expect(full.events).toHaveLength(200);
  });
});

describe("real units, automatic sampling and live multipliers", () => {
  it.each(["constant", "burst", "ramp", "spike"] as const)(
    "samples %s traffic and evaluates expectations in real units",
    (kind) => {
      const shapes: Record<"constant" | "burst" | "ramp" | "spike", TrafficShape> = {
        constant: { kind: "constant", ratePerSec: 200, durationMs: 1000 },
        burst: { kind: "burst", count: 200, spreadMs: 1000 },
        ramp: { kind: "ramp", startRate: 100, stages: [{ durationMs: 1000, targetRate: 300 }] },
        spike: { kind: "spike", baseRate: 100, peakRate: 300, atMs: 250, peakMs: 500, durationMs: 1000 },
      };
      const d = diagram([node("s", "sink")]);
      const run = createSimulationRun(
        d,
        simulation({
          scale: 5,
          multipliers: { traffic: 2 },
          traffic: [{ id: "t", node: "s", shape: shapes[kind] }],
          expectations: [{ id: "e", label: "Real", metric: { node: "s", field: "processed" }, op: "==", value: 400 }],
        }),
        options,
      );
      run.step(5000);
      expect(run.engine.frame().nodes.s.processed).toBe(80);
      expect(run.engine.snapshot().scale).toBe(5);
      expect(run.state().expectations[0]).toMatchObject({ status: "pass", value: 400 });
    },
  );
  it("scales timeline injections and live traffic; capacity changes do not overwrite setup/timeline props", () => {
    const d = diagram([node("s", "sink"), node("p", "processor", { replicas: 2 })]);
    const run = createSimulationRun(
      d,
      simulation({
        scale: 2,
        multipliers: { traffic: 2, capacity: 2 },
        setup: { props: { p: { replicas: 3 } } },
        traffic: [{ id: "t", node: "s", shape: { kind: "constant", ratePerSec: 20, durationMs: 2000 } }],
        timeline: [
          { atMs: 0, action: { do: "inject", node: "s", count: 10 } },
          { atMs: 1000, action: { do: "props", node: "p", props: { replicas: 4 } } },
        ],
      }),
      options,
    );
    expect(run.engine.frame().nodes.p.replicas).toBe(6);
    run.step(1000);
    expect(run.engine.frame().nodes.s.processed).toBe(30);
    run.setMultipliers({ traffic: 4, capacity: 0.5 });
    expect(run.engine.frame().nodes.p.replicas).toBe(2);
    expect(run.engine.effectiveProps("p").replicas).toBe(4);
    run.step(1000);
    expect(run.engine.frame().nodes.s.processed).toBe(70);
    const current = run.state();
    run.setMultipliers({ traffic: NaN, capacity: -1 });
    expect(run.state().multipliers).toEqual(current.multipliers);
    run.restart();
    expect(run.engine.frame().nodes.p.replicas).toBe(6);
    expect(run.state().multipliers).toEqual({ traffic: 2, capacity: 2 });
  });
  it("keeps fractional credits per profile at sampled rates and applies zero traffic", () => {
    const run = createSimulationRun(
      diagram([node("s", "sink")]),
      simulation({
        scale: 10,
        traffic: [{ id: "t", node: "s", shape: { kind: "constant", ratePerSec: 25, durationMs: 4000 } }],
      }),
      options,
    );
    run.step(1000);
    expect(run.engine.frame().nodes.s.processed).toBe(2);
    run.setMultipliers({ traffic: 0 });
    run.step(1000);
    expect(run.engine.frame().nodes.s.processed).toBe(2);
    run.setMultipliers({ traffic: 1 });
    run.step(2000);
    expect(run.engine.frame().nodes.s.processed).toBe(7);
  });
  it("sampling preserves processor real throughput capacity and per-message latency", () => {
    const d = diagram([node("p", "processor", { replicas: 2, concurrency: 2, latencyMs: 100, jitter: 0 })]);
    const run = createSimulationRun(
      d,
      simulation({
        scale: 10,
        durationMs: 30000,
        traffic: [{ id: "t", node: "p", shape: { kind: "constant", ratePerSec: 100, durationMs: 30000 } }],
      }),
      options,
    );
    run.step(30000);
    const real = realNodeMetrics(run.engine.frame().nodes.p, 10);
    expect(real.processed / 30).toBeGreaterThan(37);
    expect(real.processed / 30).toBeLessThanOrEqual(40);
    expect(real.backlog).toBeGreaterThan(1500);
    const last = run.engine.snapshot().events.filter((event) => event.kind === "process");
    expect(last.length).toBeGreaterThan(0);
  });
  it("helpers convert message metrics and preserve replica counts, particle geometry and clocks", () => {
    const e = engine(diagram([node("p", "processor", { replicas: 3, concurrency: 1, latencyMs: 100, jitter: 0 })]));
    e.setScale(5);
    e.inject("p", 10);
    e.step(500);
    const raw = e.snapshot(),
      real = realSnapshot(raw);
    expect(real.nodes.p.processed).toBe(raw.nodes.p.processed * 5);
    expect(real.nodes.p.backlog).toBe(raw.nodes.p.backlog * 5);
    expect(real.nodes.p.throughput).toBe(raw.nodes.p.throughput * 5);
    expect(real.nodes.p.replicas).toBe(3);
    expect(real.time).toBe(raw.time);
    expect(real.inSystem).toBe(raw.inSystem * 5);
    expect(toSimulatedUnits(toRealUnits(3, 20), 20)).toBe(3);
    expect(toRealUnits(3, NaN)).toBe(3);
  });
  it.each([
    [60, 1],
    [61, 2],
    [2000, 50],
    [6000, 100],
    [6001, 200],
  ] as const)("autoScale(%s/s) = %s", (rate, scale) => {
    const d = diagram([node("s", "source")]);
    const input = simulation({
      traffic: [{ id: "t", node: "s", shape: { kind: "constant", ratePerSec: rate, durationMs: 1000 } }],
    });
    const before = structuredClone(input);
    expect(autoScale(input, d)).toBe(scale);
    expect(input).toEqual(before);
  });
  it("autoScale includes simultaneous profiles, bursts and traffic multipliers and ignores unknown nodes", () => {
    const d = diagram([node("s", "source")]);
    const input = simulation({
      multipliers: { traffic: 2 },
      traffic: [
        { id: "a", node: "s", shape: { kind: "burst", count: 100, spreadMs: 5000 } },
        { id: "b", node: "s", shape: { kind: "constant", ratePerSec: 40, durationMs: 1000 } },
        { id: "c", node: "missing", shape: { kind: "burst", count: 100000 } },
      ],
    });
    expect(autoScale(input, d)).toBe(2);
  });
  it("checkpoint restores scale, capacity multiplier and weighted service credit", () => {
    const e = engine(diagram([node("p", "processor", { replicas: 2, latencyMs: 100 })]));
    e.setScale(10);
    e.setCapacityMultiplier(2);
    e.inject("p", 100);
    e.step(50);
    const checkpoint = e.checkpoint(),
      before = e.snapshot();
    e.step(1000);
    const after = e.snapshot();
    e.setScale(1);
    e.setCapacityMultiplier(3);
    e.restore(checkpoint);
    expect(e.snapshot()).toEqual(before);
    e.step(1000);
    expect(e.snapshot()).toEqual(after);
  });
});

describe("phase 4 boundary regressions", () => {
  it.each(["requeue", "inplace"] as const)("%s ordering under a backlog", (retry) => {
    const e = engine(
      diagram(
        [
          node("b", "queue", { maxDeliveryCount: 2 }),
          node("p", "processor", { retry, failureRate: 1, latencyMs: 20, jitter: 0, concurrency: 1 }),
        ],
        [edge("b", "p")],
      ),
    );
    e.inject("b", 20);
    e.step(100);
    const failures = e.snapshot().events.filter((event) => event.kind === "fail");
    expect(failures.slice(0, 2).map((event) => event.messageId)).toEqual(retry === "inplace" ? [1, 1] : [1, 2]);
  });
  it("broker targets reserve partitions without reporting negative idle replica counts", () => {
    const e = engine(
      diagram([node("t", "topic", { partitions: 8 }), node("q", "queue")], [edge("t", "q", { travelMs: 100 })]),
    );
    e.inject("t", 30);
    e.step(10);
    expect(e.frame().particles).toHaveLength(8);
    expect(e.frame().nodes.q).toMatchObject({ replicas: 1, activeReplicas: 1, idleReplicas: 0 });
  });
  it("real-unit helpers scale lag, edge activity and all counters independently of raw state", () => {
    const e = engine(
      diagram(
        [node("s", "source"), node("q", "queue"), node("p", "processor", { status: "paused" })],
        [edge("s", "q", { travelMs: 100 }), edge("q", "p")],
      ),
    );
    e.setScale(5);
    e.inject("q", 3);
    e.inject("s", 2);
    e.step(10);
    const raw = e.snapshot(),
      real = realSnapshot(raw);
    expect(real.nodes.q.lag.queue).toBe(15);
    expect(real.edges["s-q"].active).toBe(10);
    real.nodes.q.lag.queue = 1000;
    expect(raw.nodes.q.lag.queue).toBe(3);
    const modified = { ...raw.nodes.p, failed: 2, dropped: 3, deadLettered: 4 };
    expect(realNodeMetrics(modified, 5)).toMatchObject({ failed: 10, dropped: 15, deadLettered: 20 });
  });
  it("unknown timeline injection and another entry never consume a node's fractional credits", () => {
    const run = createSimulationRun(
      diagram([node("a", "sink"), node("b", "sink")]),
      simulation({
        scale: 10,
        timeline: [
          { atMs: 0, action: { do: "inject", node: "missing", count: 5 } },
          { atMs: 0, action: { do: "inject", node: "a", count: 5 } },
          { atMs: 0, action: { do: "inject", node: "b", count: 5 } },
          { atMs: 100, action: { do: "inject", node: "a", count: 5 } },
        ],
      }),
      options,
    );
    expect(run.engine.frame().nodes.a.processed).toBe(0);
    expect(run.engine.frame().nodes.b.processed).toBe(0);
    run.step(100);
    expect(run.engine.frame().nodes.a.processed).toBe(1);
    expect(run.engine.frame().nodes.b.processed).toBe(0);
  });
  it("live traffic multiplier changes preserve previously scheduled spread-burst counts", () => {
    const run = createSimulationRun(
      diagram([node("s", "sink")]),
      simulation({ scale: 2, traffic: [{ id: "t", node: "s", shape: { kind: "burst", count: 20, spreadMs: 1000 } }] }),
      options,
    );
    run.step(200);
    run.setMultipliers({ traffic: 0 });
    run.step(2000);
    expect(run.engine.frame().nodes.s.processed).toBe(10);
  });
  it("short spread bursts choose sufficient sampling and instantaneous batches use a second", () => {
    const d = diagram([node("s", "source")]);
    const input = simulation({
      traffic: [{ id: "t", node: "s", shape: { kind: "burst", count: 100, spreadMs: 500 } }],
    });
    expect(autoScale(input, d)).toBe(5);
    input.traffic[0].shape = { kind: "burst", count: 100 };
    expect(autoScale(input, d)).toBe(2);
  });
  it("source free play uses the sampling weight and autoScale reads setup source rates", () => {
    const e = engine(diagram([node("s", "source", { ratePerSec: 100 })]));
    e.setScale(5);
    e.setTraffic(true);
    e.step(1000);
    expect(e.frame().nodes.s.processed).toBe(20);
    const d = diagram([{ ...node("s", "source"), stencil: "client.user" }]);
    expect(autoScale(simulation({ setup: { props: { s: { ratePerSec: 2000 } } } }), d)).toBe(50);
  });
  it("a nonbroker push input uses the full fleet alongside a partition-limited subscription", () => {
    const e = engine(
      diagram(
        [
          node("t", "topic", { partitions: 1 }),
          node("s", "source"),
          node("p", "processor", { replicas: 3, concurrency: 2, latencyMs: 1000 }),
        ],
        [edge("t", "p"), edge("s", "p")],
      ),
    );
    expect(e.frame().nodes.p.activeReplicas).toBe(3);
    e.inject("t", 20);
    e.step(30);
    expect(e.frame().nodes.p.inFlight).toBe(2);
    e.inject("s", 20);
    e.step(30);
    expect(e.frame().nodes.p.inFlight).toBe(6);
  });
});

it("autoScale includes large timeline injection batches", () => {
  const d = diagram([node("s", "sink")]);
  expect(autoScale(simulation({ timeline: [{ atMs: 0, action: { do: "inject", node: "s", count: 2000 } }] }), d)).toBe(
    50,
  );
});
