import { watchCheckpoints } from "../test/checkpointProbe";
import { describe, expect, it } from "vitest";
import type { DiagramFile, SimRole } from "../model/types";
import { createEngine } from "./engine";
import {
  createLatencyRecorder,
  createLatencyBudget,
  shareLatencyRecorder,
  recordLatency,
  latencyMetrics,
  LATENCY_BUCKETS,
  LATENCY_TYPES,
  LATENCY_TYPE_HISTOGRAMS,
} from "./latency";
import { latencyBudgetFixture } from "../lab/latencyBudgetFixture";
import { validateDiagram } from "../interop/native";
import { LiveController } from "../live/controller";
import { realFrame } from "./units";
import { createSimulationRun } from "./simulation";
import example from "../examples/where-the-time-goes.json";

function diagram(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Async timing",
    groups: [],
    nodes: [
      { id: "source", stencil: "source", label: "Source", x: 0, y: 0 },
      { id: "queue", stencil: "queue", label: "Queue", x: 0, y: 0 },
      {
        id: "worker",
        stencil: "processor",
        label: "Worker",
        x: 0,
        y: 0,
        props: { latencyMs: 100, concurrency: 1, jitter: 0 },
      },
      { id: "sink", stencil: "sink", label: "Sink", x: 0, y: 0 },
    ],
    edges: [
      { id: "sq", from: "source", to: "queue", kind: "async", props: { travelMs: 10 } },
      { id: "qw", from: "queue", to: "worker", kind: "async", props: { travelMs: 10 } },
      { id: "ws", from: "worker", to: "sink", kind: "async", props: { travelMs: 10 } },
    ],
  };
}
const engine = (d = diagram()) => {
  const e = createEngine({ seed: 7, roleOf: (id) => id as SimRole });
  e.load(d);
  return e;
};

describe("bounded async latency", () => {
  it("shares unchanged buckets and copies only distributions written after capture in either direction", () => {
    const r = createLatencyRecorder();
    recordLatency(r, "A", 0, 100, 10);
    recordLatency(r, "B", 0, 200, 10);
    const captured = shareLatencyRecorder(r);
    expect(captured.total.buckets).toBe(r.total.buckets);
    expect(captured.types.get("A")!.buckets).toBe(r.types.get("A")!.buckets);
    const before = latencyMetrics(captured);
    recordLatency(r, "A", 0, 300, 10);
    expect(captured.total.buckets).not.toBe(r.total.buckets);
    expect(captured.types.get("A")!.buckets).not.toBe(r.types.get("A")!.buckets);
    expect(captured.types.get("B")!.buckets).toBe(r.types.get("B")!.buckets);
    expect(latencyMetrics(captured)).toEqual(before);
    const live = latencyMetrics(r);
    recordLatency(captured, "B", 0, 400, 10);
    expect(latencyMetrics(r)).toEqual(live);
    expect(latencyMetrics(captured).byType.B.samples).toBe(2);
  });

  it("bounds retained bucket storage across 24 checkpoints for 200 sinks × 64 types", () => {
    const d = latencyBudgetFixture();
    expect(validateDiagram(d).ok).toBe(true);
    const run = createSimulationRun(d, d.simulations![0], { roleOf: (id) => id as SimRole });
    run.step(1000);
    // Observe the actual checkpoint graphs after their latency recorders have been attached.
    // Count distinct allocated bucket arrays, not heap estimates or checkpoint timing.
    const probe = watchCheckpoints(24);
    const checkpoints = [];
    try {
      for (let i = 0; i < 24; i++) {
        checkpoints.push(run.checkpoint());
        run.step(5000);
      }
      for (const checkpoint of checkpoints) run.restore(checkpoint);
      const buckets = new Set<number[]>();
      let typed = 0;
      for (const graph of probe.copies) {
        let perCheckpoint = 0;
        for (const node of graph.nodes.values()) {
          if (!node.latency) continue;
          buckets.add(node.latency.total.buckets);
          for (const h of node.latency.types.values()) buckets.add(h.buckets);
          perCheckpoint += node.latency.types.size;
        }
        typed = Math.max(typed, perCheckpoint);
      }
      const slots = [...buckets].reduce((sum, b) => sum + b.length, 0);
      // 1,253,376 bytes (1.20 MiB) of numeric bucket payload, including live state
      // shared with these unchanged checkpoints; previously 319,488,000 bytes (304.69 MiB).
      expect({ typed, slots }).toEqual({
        typed: LATENCY_TYPE_HISTOGRAMS,
        slots: (200 + LATENCY_TYPE_HISTOGRAMS) * LATENCY_BUCKETS,
      });
      expect(checkpoints).toHaveLength(24);
    } finally {
      probe.stop();
    }
    const totals = Object.values(run.engine.frame().nodes).flatMap((n) => (n.latency ? [n.latency] : []));
    expect(totals).toHaveLength(200);
    expect(totals.every((n) => n.samples === 64)).toBe(true);
    expect(totals.some((n) => n.typesLimited)).toBe(true);
  });

  it("keeps recording an allocated type after another recorder exhausts the shared budget", () => {
    const budget = createLatencyBudget();
    const kept = createLatencyRecorder();
    recordLatency(kept, "Order", 0, 10, 3, budget);
    const before = latencyMetrics(kept);
    for (let i = 1; i < LATENCY_TYPE_HISTOGRAMS; i++)
      recordLatency(createLatencyRecorder(), `Other${i}`, 0, 20, 0, budget);
    const refused = createLatencyRecorder();
    recordLatency(refused, "New", 0, 30, 0, budget);
    expect(budget.remaining).toBe(0);
    expect(latencyMetrics(refused)).toMatchObject({ samples: 1, byType: {}, typesLimited: true });
    recordLatency(kept, "Order", 20, 980, 7, budget);
    recordLatency(kept, "Order", 20, 980, 7, budget);
    const after = latencyMetrics(kept);
    expect(after.byType.Order).toMatchObject({ samples: 3, waitMs: 40, workMs: 1970, travelMs: 17 });
    expect(after.byType.Order.p50).toBe(1000);
    expect(after.byType.Order.p95).toBe(1000);
    expect(after.byType.Order.p99).toBe(1000);
    expect(after.samples).toBe(3);
    expect(before.byType.Order).toMatchObject({ samples: 1, p50: 10, p95: 10, p99: 10 });
    expect(budget.remaining).toBe(0);
  });

  it("restores the run-wide budget and identical readouts on seek and replay after fallback", () => {
    const d = latencyBudgetFixture();
    // A second population crosses checkpoints while the budget is already exhausted.
    d.simulations![0].timeline = [
      { atMs: 7000, action: { do: "inject", node: "source", count: 1, messageType: "Later" } },
    ];
    const c = new LiveController(d, { roleOf: (id) => id as SimRole });
    try {
      c.selectSimulation(d.simulations![0]);
      c.seek(9000);
      const end = c.snapshot();
      expect(end.nodes["sink-199"].latency).toMatchObject({ samples: 65, typesLimited: true });
      expect(Object.keys(end.nodes["sink-199"].latency!.byType).length).toBeLessThan(LATENCY_TYPES);
      c.seek(5500); // Restore a budget-exhausted checkpoint.
      c.seek(9000);
      expect(c.snapshot()).toEqual(end);
      c.seek(0); // Replay budget allocation itself from the origin.
      c.seek(9000);
      expect(c.snapshot()).toEqual(end);
      c.restart();
      c.seek(9000);
      expect(c.snapshot()).toEqual(end);
    } finally {
      c.dispose();
    }
  });
  it("reuses immutable readouts between samples and preserves earlier frames after another arrival", () => {
    const recorder = createLatencyRecorder();
    recordLatency(recorder, "Order", 10, 100, 30);
    const first = latencyMetrics(recorder);
    expect(latencyMetrics(recorder)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.byType)).toBe(true);
    expect(Object.isFrozen(first.byType.Order)).toBe(true);
    recordLatency(recorder, "Order", 20, 100, 30);
    expect(latencyMetrics(recorder).samples).toBe(2);
    expect(first.samples).toBe(1);
    expect(first.byType.Order.samples).toBe(1);
  });
  it("records zero and long tails, bounded buckets and type cardinality without retaining samples", () => {
    const r = createLatencyRecorder();
    recordLatency(r, "zero", 0, 0, 10);
    expect(latencyMetrics(r).p99).toBe(0);
    for (let i = 0; i < 1000; i++) recordLatency(r, String(i), i, 100, 20);
    const metrics = latencyMetrics(r);
    expect(r.total.buckets).toHaveLength(LATENCY_BUCKETS);
    expect(r.types.size).toBe(LATENCY_TYPES);
    expect(metrics).toMatchObject({ samples: 1001, typesLimited: true });
    expect(metrics.p50).toBeGreaterThanOrEqual(599);
    expect(metrics.p50).toBeLessThanOrEqual(599 * 1.12);
    recordLatency(r, "huge", 1e12, 0, 0);
    expect(latencyMetrics(r).p99).toBeGreaterThan(0);
    const long = createLatencyRecorder();
    recordLatency(long, "long", 1e12, 0, 0);
    expect(latencyMetrics(long).p50).toBe(1e12);
  });

  it("measures whole paths, queue wait and work separately from animation, with unscaled sample counts", () => {
    const e = engine();
    e.setScale(10);
    e.inject("source", 20, { type: "Order" });
    e.step(30000);
    const s = e.frame().nodes.sink.latency!;
    expect(s.samples).toBe(20);
    expect(s.waitMs).toBeGreaterThan(s.workMs);
    expect(s.travelMs).toBe(20 * 30);
    expect(s.byType.Order.samples).toBe(20);
    expect(s.p95).toBeGreaterThan(s.p50);
    expect(realFrame(e.frame()).nodes.sink.latency).toEqual(s);
    const detached = e.frame();
    expect(Object.isFrozen(detached.nodes.sink.latency!.byType.Order)).toBe(true);
    expect(e.frame().nodes.sink.latency!.byType.Order.samples).toBe(20);
  });

  it("copies branch timing independently, even when one branch travels over a Request", () => {
    const d = diagram();
    d.nodes.push({ id: "other", stencil: "sink", label: "Other", x: 0, y: 0 });
    d.edges.push({ id: "wo", from: "worker", to: "other", kind: "sync", props: { travelMs: 500 } });
    const e = engine(d);
    e.inject("source", 1);
    e.step(2000);
    expect(e.frame().nodes.sink.latency).toMatchObject({ samples: 1, travelMs: 30 });
    expect(e.frame().nodes.other.latency).toBeUndefined();
    expect(e.metrics().inSystem).toBe(0);
  });

  it.each(["requeue", "inplace"])("preserves birth and all attempts through %s retries and checkpoints", (retry) => {
    const d = diagram();
    d.nodes[2].props = { ...d.nodes[2].props, retry, retryBackoffMs: 200, failureRate: 1 };
    const e = engine(d);
    e.inject("source", 1);
    e.step(150);
    const checkpoint = e.checkpoint();
    const finish = () => {
      e.setNodeProps("worker", { failureRate: 0 });
      e.step(1500);
      return e.snapshot();
    };
    const first = finish();
    e.restore(checkpoint);
    expect(finish()).toEqual(first);
    expect(first.nodes.sink.latency).toMatchObject({ samples: 1 });
    expect(first.nodes.sink.latency!.waitMs).toBeGreaterThanOrEqual(200);
    expect(first.nodes.sink.latency!.workMs).toBeGreaterThan(100);
    expect(first.nodes.sink.latency!.travelMs).toBe(retry === "inplace" ? 30 : 50);
  });

  it("excludes failed attempts and exhausted deliveries; reset discards recordings", () => {
    const d = diagram();
    d.nodes[2].props = { failureRate: 1, latencyMs: 10, jitter: 0 };
    const e = engine(d);
    e.inject("source", 2);
    e.step(3000);
    expect(e.frame().nodes.worker.latency).toBeUndefined();
    expect(e.frame().nodes.sink.latency).toBeUndefined();
    e.setNodeProps("worker", { failureRate: 0 });
    e.inject("source", 1);
    e.step(1000);
    expect(e.frame().nodes.sink.latency!.samples).toBe(1);
    e.reset();
    expect(e.frame().nodes.sink.latency).toBeUndefined();
  });

  it("counts paused residence as waiting and leaves unread brokers outside the completion population", () => {
    const e = engine();
    e.inject("source", 1);
    e.step(50);
    e.setNodeStatus("worker", "paused");
    e.step(500);
    e.setNodeStatus("worker", "up");
    e.step(1000);
    expect(e.frame().nodes.sink.latency).toMatchObject({ samples: 1, waitMs: 500, workMs: 100, travelMs: 30 });
    const d = diagram();
    d.edges = d.edges.filter((edge) => edge.id !== "qw");
    const parked = engine(d);
    parked.inject("source", 1);
    parked.step(1000);
    expect(parked.frame().nodes.queue.backlog).toBe(1);
    expect(parked.frame().nodes.queue.latency).toBeUndefined();
    expect(parked.frame().nodes.sink.latency).toBeUndefined();
  });

  it("keeps an in-place retry's frozen backoff in waiting when paused mid-backoff", () => {
    const replay = (pause: boolean) => {
      const d = diagram();
      d.nodes[2].props = { ...d.nodes[2].props, retry: "inplace", retryBackoffMs: 200, failureRate: 1 };
      const e = engine(d);
      e.inject("source", 1);
      e.step(150);
      if (pause) {
        e.setNodeStatus("worker", "paused");
        e.step(500);
        e.setNodeStatus("worker", "up");
      }
      e.setNodeProps("worker", { failureRate: 0 });
      e.step(1000);
      return e.frame().nodes.sink.latency!;
    };
    const baseline = replay(false),
      paused = replay(true);
    expect(paused.workMs).toBe(baseline.workMs);
    expect(paused.waitMs).toBe(baseline.waitMs + 500);
  });

  it("measures multi-worker paths without composing per-hop percentiles", () => {
    const d = diagram();
    d.nodes[1] = {
      ...d.nodes[1],
      stencil: "processor",
      props: { latencyMs: 100, concurrency: 1, jitter: 0 },
    };
    const e = engine(d);
    for (let i = 0; i < 20; i++) {
      e.setNodeProps("queue", { latencyMs: i % 2 ? 900 : 100 });
      e.setNodeProps("worker", { latencyMs: i % 2 ? 100 : 900 });
      e.inject("source", 1, { type: "Order" });
      e.step(2000);
    }
    const frame = e.frame();
    expect(frame.nodes.queue.latency!.workMs).toBe(10000);
    expect(frame.nodes.queue.latency!.p95).toBe(900);
    for (const id of ["worker", "sink"]) {
      expect(frame.nodes[id].latency).toMatchObject({
        samples: 20,
        workMs: 20000,
        waitMs: 0,
        p50: 1000,
        p95: 1000,
        p99: 1000,
      });
      expect(frame.nodes[id].latency!.byType.Order.p95).toBe(1000);
    }
  });

  it("excludes animation on both fast and slow edges", () => {
    const read = (travelMs: number) => {
      const d = diagram();
      for (const edge of d.edges) edge.props = { travelMs };
      const e = engine(d);
      e.inject("source", 1);
      e.step(4000);
      return e.frame().nodes.sink.latency!;
    };
    const fast = read(10),
      slow = read(500);
    expect(slow.p95).toBe(fast.p95);
    expect(slow.travelMs).toBe(1500);
    expect(fast.travelMs).toBe(30);
    expect(slow.workMs).toBe(fast.workMs);
  });

  it("replays sampled percentiles and breakdowns from a saved-run checkpoint and a restart", () => {
    const d = example as DiagramFile;
    const run = createSimulationRun(d, d.simulations![0]);
    run.step(5500);
    const checkpoint = run.checkpoint();
    run.step(4000);
    const end = run.engine.frame();
    run.restore(checkpoint);
    run.step(4000);
    expect(run.engine.frame()).toEqual(end);
    run.restart();
    run.step(9500);
    expect(run.engine.frame()).toEqual(end);
  });
});

it("drills reset aggregate and per-type percentiles on effective fault changes, retain counters and replay windows", () => {
  const run = createSimulationRun(
    diagram(),
    {
      id: "fault-window",
      title: "Fault window",
      traffic: [],
      durationMs: 10000,
      timeline: [{ atMs: 9000, action: { do: "fault", fault: { kind: "slow", node: "worker", factor: 5 } } }],
    },
    { roleOf: (id) => id as SimRole },
  );
  const e = run.engine;
  e.inject("source", 10, { type: "Order" });
  run.step(2000);
  const before = e.snapshot().nodes.sink;
  expect(before.latency!.samples).toBe(10);
  const healthy = run.checkpoint();
  const slow = { kind: "slow", node: "worker", factor: 5 } as const;
  e.setFault(slow);
  expect(e.snapshot().nodes.sink.latency).toBeUndefined();
  expect(e.snapshot().nodes.sink.processed).toBe(before.processed);
  e.inject("source", 1, { type: "Order" });
  run.step(1000);
  const faulted = e.snapshot().nodes.sink.latency!;
  expect(faulted).toMatchObject({
    samples: 1,
    p50: 500,
    p95: 500,
    byType: { Order: { samples: 1 } },
    sinceFault: { atMs: 2000, fault: slow },
  });
  e.setFault({ factor: 5, node: "worker", kind: "slow" }); // Key order does not make an effective change.
  expect(e.snapshot().nodes.sink.latency).toEqual(faulted);
  const faultCheckpoint = run.checkpoint();
  expect(Object.isFrozen(faulted.sinceFault)).toBe(true);
  expect(Object.isFrozen(faulted.sinceFault!.fault)).toBe(true);
  expect(() => Object.assign(faulted.sinceFault!, { atMs: -1 })).toThrow(TypeError);
  expect(() => Object.assign(faulted.sinceFault!.fault, { factor: 10 })).toThrow(TypeError);
  e.setFault({ ...slow, factor: 1 });
  expect(e.snapshot().nodes.sink.latency).toBeUndefined();
  e.inject("source", 1, { type: "Order" });
  run.step(500);
  expect(e.snapshot().nodes.sink.latency).toMatchObject({
    samples: 1,
    p95: 100,
    sinceFault: { atMs: 3000, fault: { ...slow, factor: 1 } },
  });
  run.restore(faultCheckpoint);
  expect(e.snapshot().nodes.sink.latency).toEqual(faulted);
  run.restore(healthy);
  expect(e.snapshot().nodes.sink.latency).toEqual(before.latency);
  run.restart();
  expect(e.snapshot().nodes.sink.latency).toBeUndefined();
  e.inject("source", 1);
  run.step(500);
  expect(e.snapshot().nodes.sink.latency!.sinceFault).toBeUndefined();
});

it("Free play keeps its cumulative latency through faults", () => {
  const e = engine();
  e.inject("source", 1);
  e.step(500);
  const latency = e.snapshot().nodes.sink.latency;
  e.setFault({ kind: "slow", node: "worker", factor: 5 });
  expect(e.snapshot().nodes.sink.latency).toEqual(latency);
});

// Review of #237: a broker delivers parts of a dot, and each sample weighs its dots, so percentiles rank by weight.
it.each([
  { name: "less than a dot", fast: 0.96, slow: 0.04, p50: "fast", p95: "fast" },
  { name: "less than a dot, slow tail", fast: 0.6, slow: 0.3, p50: "fast", p95: "slow" },
  { name: "more than a dot", fast: 1.5, slow: 0.7, p50: "fast", p95: "slow" },
])("weighted percentiles preserve unequal split-dot distributions ($name)", ({ fast, slow, p50, p95 }) => {
  const recorder = createLatencyRecorder();
  recordLatency(recorder, "Order", 0, 100, 0, undefined, undefined, undefined, fast);
  recordLatency(recorder, "Order", 0, 1000, 0, undefined, undefined, undefined, slow);
  const bucket = (ms: number) => (ms < 200 ? "fast" : "slow");
  for (const summary of [latencyMetrics(recorder), latencyMetrics(recorder).byType.Order]) {
    expect(summary.samples).toBeCloseTo(fast + slow, 9);
    expect([bucket(summary.p50), bucket(summary.p95)]).toEqual([p50, p95]);
    expect(summary.p99).toBe(1000);
  }
});

it("whole samples keep their nearest-rank percentiles", () => {
  const recorder = createLatencyRecorder();
  for (let i = 0; i < 95; i++) recordLatency(recorder, "Order", 0, 100, 0);
  for (let i = 0; i < 5; i++) recordLatency(recorder, "Order", 0, 1000, 0);
  const summary = latencyMetrics(recorder);
  expect(summary.samples).toBe(100);
  expect(summary.p95).toBeLessThan(200);
  expect(summary.p99).toBe(1000);
});
