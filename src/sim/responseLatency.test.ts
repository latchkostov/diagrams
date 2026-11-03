import { watchCheckpoints } from "../test/checkpointProbe";
import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { LATENCY_BUCKETS } from "./latency";

function slowChain(): DiagramFile {
  return {
    format: "diagrams/v2",
    title: "Awaited response times",
    planning: { revision: "p3-w3" },
    nodes: [
      { id: "client", stencil: "client.browser", label: "Client", x: 0, y: 0 },
      {
        id: "service",
        stencil: "generic.service",
        label: "Service",
        x: 300,
        y: 0,
        props: { latencyMs: 100, jitter: 0, concurrency: 1 },
      },
      {
        id: "database",
        stencil: "generic.database",
        label: "Database",
        x: 600,
        y: 0,
        props: { latencyMs: 500, jitter: 0 },
      },
    ],
    edges: [
      { id: "request", from: "client", to: "service", kind: "sync", props: { networkDelayMs: 200 } },
      {
        id: "query",
        from: "service",
        to: "database",
        kind: "sync",
        props: { networkDelayMs: 50, caller: { wait: "non-blocking", replyMs: 150 } },
      },
    ],
  };
}

it("fails tight p95 expectations for completed awaited services and databases", () => {
  const run = createSimulationRun(slowChain(), {
    id: "slow",
    title: "Slow replies",
    seed: 7,
    durationMs: 3000,
    traffic: [{ id: "request", node: "client", shape: { kind: "burst", count: 1 } }],
    expectations: ["service", "database"].map((node) => ({
      id: node,
      label: `${node} replies within 100 ms`,
      metric: { node, field: "p95" },
      op: "<",
      value: 100,
    })),
  });
  run.step(3000);
  expect(run.state().done).toBe(true);
  const snapshot = run.engine.snapshot();
  expect(snapshot.nodes.service.processed).toBe(1);
  expect(snapshot.nodes.database.processed).toBe(1);
  const service = run.engine.measure({ node: "service", field: "p95" })!;
  const database = run.engine.measure({ node: "database", field: "p95" })!;
  expect(database).toBe(500);
  // Local service work + both downstream network legs + database work + reply continuation.
  expect(service).toBe(100 + 2 * 50 + 500 + 150);
  expect(run.state().expectations.map((e) => [e.value, e.status])).toEqual([
    [service, "fail"],
    [database, "fail"],
  ]);
  // The established source response and non-cache readouts keep their separate semantics.
  expect(run.engine.measure({ node: "client", field: "p95" })).toBe(snapshot.nodes.client.latency!.p95);
  expect(snapshot.nodes.client.latency!.p95).toBeGreaterThan(service);
  expect(snapshot.nodes.service.latency).toBeUndefined();
  expect(snapshot.nodes.database.latency).toBeUndefined();
});

it("captures bounded awaited response histograms and restores them independently for exact replay", () => {
  const engine = createEngine({ seed: 7 });
  engine.load(slowChain());
  const measure = () => ["service", "database"].map((node) => engine.measure({ node, field: "p95" }));
  engine.inject("client", 1);
  engine.step(2000);
  const watch = watchCheckpoints();
  const token = engine.checkpoint();
  const before = measure();
  const suffix = () => {
    engine.setNodeProps("database", { latencyMs: 1000 });
    engine.inject("client", 100, { spreadMs: 10_000 });
    engine.step(30_000);
    return { values: measure(), snapshot: engine.snapshot() };
  };
  const expected = suffix();
  expect(expected.values[0]).toBeGreaterThan(before[0]!);
  expect(expected.values[1]).toBeGreaterThan(before[1]!);
  engine.restore(token);
  expect(measure()).toEqual(before);
  expect(suffix()).toEqual(expected);
  const graph = watch.copies[0];
  watch.stop();
  const full = engine.checkpoint();
  for (const node of ["service", "database"]) {
    const recorder = graph[0].get(node)!.responseLatency!;
    expect(recorder.total.samples).toBe(101);
    expect(recorder.total.buckets).toHaveLength(LATENCY_BUCKETS);
    expect(recorder.types.size).toBe(0);
  }
  const bytes = full.bytes;
  for (const node of graph[0].values()) node.responseLatency = undefined;
  const baseline = engine.checkpoint().bytes;
  console.info({ responseCheckpoint: bytes, baseline, responseRecorders: bytes - baseline });
  // Two aggregate-only, fixed 128-bucket histograms; requests retain no sample list.
  expect(bytes - baseline).toBeLessThanOrEqual(3 * 1024);
  expect(bytes - baseline).toBeGreaterThanOrEqual(2 * LATENCY_BUCKETS * 8);
});

it("includes local admission wait, replays an in-flight arrival and resets the metric's latency window", () => {
  const d = slowChain();
  d.edges[1].props!.caller = { wait: "blocking" };
  const engine = createEngine({ seed: 7 });
  engine.load(d);
  engine.inject("client", 2);
  engine.step(400);
  const token = engine.checkpoint();
  expect(engine.snapshot().nodes.service.threads!.queued).toBe(1);
  const suffix = () => {
    engine.step(3000);
    return { service: engine.measure({ node: "service", field: "p95" }), snapshot: engine.snapshot() };
  };
  const expected = suffix();
  // The second request waits for the first request's entire 700 ms service, then performs its own.
  expect(expected.service).toBe(2 * (100 + 2 * 50 + 500));
  engine.restore(token);
  expect(suffix()).toEqual(expected);
  engine.setLatencySinceFault(true);
  engine.setFault({ kind: "slow", node: "database", factor: 2 });
  expect(engine.measure({ node: "service", field: "p95" })).toBe(0);
  expect(engine.measure({ node: "database", field: "p95" })).toBe(0);
  engine.inject("client", 1);
  engine.step(3000);
  expect(engine.measure({ node: "database", field: "p95" })).toBe(1000);
  engine.reset();
  expect(engine.measure({ node: "service", field: "p95" })).toBe(0);
  expect(engine.measure({ node: "database", field: "p95" })).toBe(0);
});
