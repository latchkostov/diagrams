import { beforeAll, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { realSnapshot } from "./units";
import { cloudLesson, resourceLesson } from "../model/autoscaling";

function allowLinkCuts(d: ReturnType<typeof waitingFixture>) {
  d.groups = [
    { id: "a", label: "Caller zone", x: 0, y: 0, width: 400, height: 400 },
    { id: "b", label: "Dependency zone", x: 500, y: 0, width: 400, height: 400 },
  ];
  for (const node of d.nodes) node.group = node.id === "caller" ? "a" : "b";
}

function fixture(wait: "blocking" | "non-blocking" = "blocking", deadlineMs = 100) {
  const d = waitingFixture();
  d.edges[1].props = { travelMs: 10_000, caller: { wait, deadlineMs, replyMs: 40 } };
  return d;
}

it.each(["cut", "down", "paused"] as const)(
  "keeps logical timeout counts and timing across scales for %s dependencies",
  (fault) => {
    const histories = [1, 10].map((scale) => {
      const d = fixture();
      d.nodes[1].props!.concurrency = 100;
      d.nodes[1].props!.failureRate = 0;
      d.nodes[2] = {
        ...d.nodes[1],
        id: "partner",
        props: { concurrency: 1, latencyMs: 10, jitter: 0, failureRate: 0 },
      };
      d.edges.push({ id: "nested", from: "partner", to: "result", kind: "sync" });
      const e = createEngine({ scale, maxParticles: 0 });
      if (fault === "cut") allowLinkCuts(d);
      e.load(d);
      if (fault === "cut") e.setFault({ kind: "link", edge: "call", cut: true });
      else e.setNodeStatus("partner", fault);
      e.inject("source", 100 / scale);
      const history = [];
      for (let step = 0; step < 20; step++) {
        e.step(10);
        const s = realSnapshot(e.snapshot());
        history.push([s.edges.call.calls!.timedOut, s.nodes.caller.failed]);
      }
      expect(history.at(-1)).toEqual([fault === "down" ? 0 : 100, 100]);
      expect(e.snapshot().nodes.caller.threads!.waiting).toBe(0);
      return history;
    });
    expect(histories[1]).toEqual(histories[0]);
  },
);

it("does not dispatch pool-queued requests after their deadline", () => {
  const d = fixture("non-blocking");
  d.nodes[1].props!.concurrency = 8;
  d.edges[1].props!.caller = { wait: "non-blocking", poolConnections: 1, deadlineMs: 100 };
  const e = createEngine();
  e.load(d);
  e.inject("source", 8);
  e.step(1000);
  const s = e.snapshot();
  expect(s.nodes.caller.failed).toBe(8);
  expect(s.edges.call.calls).toMatchObject({ timedOut: 8, failed: 8, inFlight: 0, held: 0, late: 1 });
  expect(s.edges.call.delivered).toBe(1);
  expect(s.nodes.partner.processed).toBe(1);
  expect(s.inSystem).toBe(0);
});

function queuedDeadlineRun(scale: number) {
  const d = fixture("non-blocking", 600);
  d.nodes[1].props!.concurrency = 100;
  d.edges[1].props!.caller = { wait: "non-blocking", poolConnections: 1, deadlineMs: 600, replyMs: 10 };
  const dispatched = new Map<number, number>();
  const e = createEngine({
    scale,
    maxParticles: 0,
    verifyLedger({ ledger }) {
      for (const lease of ledger.reservations.values()) {
        if (lease.scope === "pool" && lease.edge === "call") dispatched.set(lease.id, lease.weight);
      }
    },
  });
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) e.step(10);
  };
  e.load(d);
  e.inject("source", 20 / scale);
  advance(50);
  const queued = e.checkpoint();
  advance(950);
  const expired = e.snapshot();
  e.restore(queued);
  advance(950);
  expect(e.snapshot()).toEqual(expired);
  expect(expired.inSystem).toBe(0);
  const checkpoint = e.checkpoint();
  advance(3000);
  const expected = e.snapshot();
  expect(expected.edges.call.calls!.inFlight).toBe(0);
  expect(expected.edges.call.delivered).toBe(expired.edges.call.delivered);
  e.restore(checkpoint);
  advance(3000);
  expect(e.snapshot()).toEqual(expected);
  const real = realSnapshot(expected);
  return {
    processed: real.nodes.partner.processed,
    timedOut: real.edges.call.calls!.timedOut,
    late: real.edges.call.calls!.late,
    delivered: real.edges.call.delivered,
    dispatched: [...dispatched.values()].reduce((sum, weight) => sum + weight, 0),
  };
}

let queuedDeadlineRuns: ReturnType<typeof queuedDeadlineRun>[];
beforeAll(() => {
  // Keep simulation, replay and cleanup checks outside it.fails: a crash must fail the suite.
  queuedDeadlineRuns = [1, 10].map(queuedDeadlineRun);
});

it("queued calls that time out are never sent at scale 1", () => {
  // Owner decision 2026-10-20: only already-sent work can reply late.
  expect(queuedDeadlineRuns[0]).toEqual({ processed: 3, timedOut: 18, late: 1, delivered: 3, dispatched: 3 });
});

// Sampling accuracy: docs/backlog/2026-10-20-deadline-queued-cohorts.md
it.fails("I1 known gap: queued deadline calls at scale 10 equal scale 1", () => {
  // Only the accuracy assertion can satisfy this expected failure.
  expect(queuedDeadlineRuns[1]).toEqual(queuedDeadlineRuns[0]);
});

it("releases a cut sibling's pool after fail-fast and drains after restoring the link", () => {
  const d = fixture("non-blocking");
  d.nodes.push({ ...d.nodes[2], id: "sibling" });
  d.edges.push({
    id: "sibling",
    from: "caller",
    to: "sibling",
    kind: "sync",
    props: {
      caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 200 },
    },
  });
  const e = createEngine();
  allowLinkCuts(d);
  e.load(d);
  e.setFault({ kind: "link", edge: "sibling", cut: true });
  e.inject("source", 4);
  e.step(1000);
  expect(e.snapshot().edges.sibling.calls!.inFlight).toBe(0);
  e.setFault({ kind: "link", edge: "sibling", cut: false });
  e.inject("source", 4);
  e.step(1000);
  expect(e.snapshot().edges.sibling.delivered).toBeGreaterThan(0);
  expect(e.snapshot().edges.sibling.calls!.inFlight).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

it.each([false, true])("checkpoints only live deadlines after traffic drains (fail-fast=%s)", (failFast) => {
  const e = createEngine({ maxParticles: 0 });
  const d = fixture("blocking", 600_000);
  if (failFast)
    d.edges.push({
      id: "expiry",
      from: "caller",
      to: "partner",
      kind: "sync",
      props: { caller: { deadlineMs: 100 } },
    });
  e.load(d);
  e.inject("source", 1000);
  e.step(100_000);
  expect(e.snapshot().inSystem).toBe(0);
  const clone = vi.spyOn(globalThis, "structuredClone");
  try {
    const checkpoint = e.checkpoint();
    const graph = clone.mock.calls[0][0] as { logical: { timeout?: boolean }[]; logicalIndices: Map<number, number> };
    expect(graph.logical.filter((event) => event.timeout)).toHaveLength(0);
    expect(graph.logicalIndices.size).toBe(graph.logical.length);
    e.restore(checkpoint);
    e.inject("source", 1);
    e.step(1000);
    expect(e.snapshot().edges.call.calls!.timedOut).toBe(0);
  } finally {
    clone.mockRestore();
  }
});

it.each(["blocking", "non-blocking"] as const)("times out %s calls without cancelling downstream work", (mode) => {
  const e = createEngine();
  e.load(fixture(mode));
  e.inject("source", 1);
  e.step(120);
  expect(e.snapshot().edges.call.calls).toMatchObject({ timedOut: 1, failed: 1, inFlight: 0, held: 0, late: 0 });
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
  expect(e.snapshot().nodes.caller.failed).toBe(mode === "blocking" ? 1 : 0);
  e.step(50);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().nodes.result.processed).toBe(0);
  e.step(500);
  expect(e.snapshot().nodes.partner.processed).toBe(1);
  expect(e.snapshot().edges.call.calls).toMatchObject({ timedOut: 1, failed: 1, late: 1 });
  expect(e.snapshot().inSystem).toBe(0);
});

it("ignores expired timers after success and restores pending deadlines exactly", () => {
  const e = createEngine();
  e.load(fixture("blocking", 500));
  e.inject("source", 4);
  e.step(100);
  const checkpoint = e.checkpoint();
  e.step(500);
  const expected = e.snapshot();
  expect(expected.nodes.caller.processed).toBe(4);
  expect(expected.edges.call.calls).toMatchObject({ timedOut: 0, late: 0 });
  e.restore(checkpoint);
  e.step(500);
  expect(e.snapshot()).toEqual(expected);
});

it.each(["blocking", "non-blocking"] as const)("discards a late error without counting a %s timeout twice", (mode) => {
  const d = fixture(mode);
  d.nodes[2].props!.api = { latencyMs: 250, errorRate: 1 };
  const e = createEngine();
  e.load(d);
  e.inject("source", 1);
  e.step(170);
  expect(e.snapshot().edges.call.calls).toMatchObject({ timedOut: 1, failed: 1, late: 0 });
  e.step(500);
  expect(e.snapshot().nodes.partner.failed).toBe(1);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().edges.call.calls).toMatchObject({ timedOut: 1, failed: 1, late: 1, inFlight: 0, held: 0 });
  expect(e.snapshot().inSystem).toBe(0);
});

it("propagates a gateway's 504 upstream and discards its late reply", () => {
  const d = fixture();
  d.nodes.push({ id: "gateway", stencil: "generic.adc", label: "Gateway", x: 0, y: 0 });
  d.edges[0] = { id: "input", from: "source", to: "gateway", kind: "sync", props: { travelMs: 10 } };
  d.edges.push({
    id: "forward",
    from: "gateway",
    to: "caller",
    kind: "sync",
    props: { caller: { deadlineMs: 50 }, travelMs: 10 },
  });
  const e = createEngine();
  e.load(d);
  e.inject("source", 1);
  e.step(70);
  expect(e.snapshot().nodes.source.failed).toBe(1);
  expect(e.snapshot().nodes.gateway.failed).toBe(1);
  expect(e.snapshot().particles.some((p) => p.edgeId === "input" && p.code === 504)).toBe(true);
  e.step(1000);
  expect(e.snapshot().edges.forward.calls).toMatchObject({ timedOut: 1, late: 1 });
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});

it.each(["requeue", "inplace"])("uses %s retry and DLQ machinery after a timeout", (retry) => {
  const d = fixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  Object.assign(d.nodes[1].props!, { retry, retryBackoffMs: 0 });
  d.nodes.push({ id: "dead", stencil: "generic.queue", label: "Failed work", x: 0, y: 0 });
  d.edges.push({ id: "dlq", from: "source", to: "dead", props: { dlq: true, travelMs: 10 } });
  const e = createEngine();
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().nodes.caller.failed).toBe(2);
  expect(e.snapshot().nodes.source.deadLettered).toBe(1);
  expect(e.snapshot().edges.call.calls).toMatchObject({ timedOut: 2, late: 2 });
  expect(e.snapshot().inSystem).toBe(1); // The DLQ retains the delivery.
});

it.each(["blocking", "non-blocking"] as const)("preserves sampled timeout capacity in %s mode", (wait) => {
  const d = fixture(wait);
  d.nodes[1].props!.concurrency = 1;
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    e.inject("source", 2000 / scale);
    e.step(30_000);
    const failed = realSnapshot(e.snapshot()).nodes.caller.failed;
    e.step(600_000);
    expect(realSnapshot(e.snapshot()).nodes.caller.failed).toBe(2000);
    expect(e.snapshot().inSystem).toBe(0);
    return failed;
  });
  expect(Math.abs(counts[1] - counts[0]), JSON.stringify(counts)).toBeLessThanOrEqual(10);
});

it.each(["blocking", "non-blocking"] as const)(
  "keeps sampled resource timeout throughput and releases memory in %s mode",
  (wait) => {
    const d = fixture(wait);
    d.nodes[1].props = { ...d.nodes[1].props, concurrency: 1, resources: { ...resourceLesson(), cpuMsPerMessage: 0 } };
    const counts = [1, 2, 10].map((scale) => {
      const e = createEngine({ scale, maxParticles: 0 });
      e.load(d);
      e.inject("source", 1000 / scale);
      e.step(30000);
      const failed = realSnapshot(e.snapshot()).nodes.caller.failed;
      e.step(600000);
      const n = e.snapshot().nodes.caller;
      expect(n.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
      expect(n.resources!.memoryMiB).toBe(resourceLesson().baselineMemoryMiB);
      expect(e.snapshot().inSystem).toBe(0);
      return failed;
    });
    for (const count of counts) expect(Math.abs(counts[0] - count), JSON.stringify(counts)).toBeLessThanOrEqual(10);
  },
);

it("uses the maximum parallel wait when a quick sibling replies before a timeout", () => {
  const d = fixture();
  d.nodes[1].props!.concurrency = 1;
  d.edges.push({ id: "quick", from: "caller", to: "result", kind: "sync" });
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    e.inject("source", 1000 / scale);
    e.step(30000);
    return realSnapshot(e.snapshot()).nodes.caller.failed;
  });
  expect(Math.abs(counts[1] - counts[0]), JSON.stringify(counts)).toBeLessThanOrEqual(10);
});

it.each(["blocking", "non-blocking"] as const)("fails a %s caller on 429 before its deadline", (wait) => {
  const d = fixture(wait, 1000);
  d.nodes[2].props!.api = {
    latencyMs: 250,
    quotas: [{ id: "requests", unit: "requests", amount: 1, windowMs: 1000, algorithm: "token-bucket", burst: 1 }],
  };
  const e = createEngine();
  e.load(d);
  e.inject("source", 2);
  e.step(1500);
  expect(e.snapshot().nodes.partner.rejected).toBe(1);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.snapshot().edges.call.calls).toMatchObject({ timedOut: 0, failed: 1, late: 0 });
});

it("checkpoints the expiry and counts a sibling as late after fail-fast", () => {
  const d = fixture();
  d.nodes.push({ ...d.nodes[2], id: "sibling" });
  d.edges.push({ id: "sibling", from: "caller", to: "sibling", kind: "sync" });
  const e = createEngine();
  e.load(d);
  e.inject("source", 1);
  e.step(50);
  const checkpoint = e.checkpoint();
  e.step(1000);
  const expected = e.snapshot();
  expect(expected.nodes.caller.failed).toBe(1);
  expect(expected.edges.sibling.calls).toMatchObject({ held: 0, inFlight: 0, late: 1 });
  e.restore(checkpoint);
  e.step(1000);
  expect(e.snapshot()).toEqual(expected);
});

it("caps the planner's thread and memory residence using the same deadline", () => {
  for (const wait of ["blocking", "non-blocking"] as const) {
    const d = fixture(wait);
    expect(analyzeCapacity(d).nodes.caller.capacity).toBeCloseTo(wait === "blocking" ? 4000 / 110 : 4000 / 50);
  }
});

it("does not mistake a nested caller's extra sampled residence for a slow response", () => {
  const d = fixture("blocking", 600);
  d.nodes[1].props!.concurrency = 1;
  d.nodes.push({ ...d.nodes[1], id: "middle", props: { ...d.nodes[1].props } });
  d.edges[1].to = "middle";
  d.edges.push({ id: "nested", from: "middle", to: "partner", kind: "sync" });
  for (const scale of [1, 10]) {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    e.inject("source", 20 / scale);
    e.step(30000);
    expect(realSnapshot(e.snapshot()).nodes.caller.processed).toBe(20);
    expect(e.snapshot().edges.call.calls!.timedOut).toBe(0);
  }
});

it("keeps a finite deadline when the downstream service has scaled to zero", () => {
  const d = fixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    concurrency: 1,
    latencyMs: 250,
    jitter: 0,
    resources: resourceLesson(),
    autoscaling: cloudLesson("cloud-run"),
  };
  d.edges.push({ id: "nested", from: "partner", to: "result", kind: "sync" });
  const e = createEngine();
  e.load(d);
  expect(e.snapshot().nodes.partner.fleet!.ready).toBe(0);
  e.inject("source", 1);
  e.step(40);
  expect(e.snapshot().edges.call.calls!.inFlight).toBe(1);
  e.step(100);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().edges.call.calls!.timedOut).toBe(1);
});

it("plans the same fail-fast parallel deadline and upstream hold as playback", () => {
  const d = fixture();
  d.nodes.push({ ...d.nodes[2], id: "sibling" });
  d.edges.push({ id: "sibling", from: "caller", to: "sibling", kind: "sync" });
  d.nodes.push({ ...d.nodes[1], id: "upstream" });
  d.edges[0].to = "upstream";
  d.edges.push({ id: "upstream", from: "upstream", to: "caller", kind: "sync" });
  const plan = analyzeCapacity(d);
  expect(plan.nodes.caller.capacity).toBeCloseTo(4000 / 110);
  expect(plan.nodes.upstream.capacity).toBeCloseTo(4000 / 120);
  const e = createEngine();
  e.load(d);
  e.inject("source", 4);
  e.step(160);
  expect(e.snapshot().nodes.upstream.failed).toBe(4);
  expect(e.snapshot().nodes.sibling.processed).toBe(0);
});

it("preserves sampled hold when a non-blocking deadline fails a mixed join", () => {
  const d = fixture("non-blocking");
  d.nodes[1].props!.concurrency = 1;
  d.nodes.push({ ...d.nodes[2], id: "sibling", props: { latencyMs: 500, api: { latencyMs: 500 }, jitter: 0 } });
  d.edges.push({ id: "sibling", from: "caller", to: "sibling", kind: "sync" });
  expect(analyzeCapacity(d).nodes.caller.capacity).toBeCloseTo(1000 / 150);
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    e.inject("source", 1000 / scale);
    e.step(30000);
    return realSnapshot(e.snapshot()).nodes.caller.failed;
  });
  expect(Math.abs(counts[1] - counts[0]), JSON.stringify(counts)).toBeLessThanOrEqual(10);
});
