import { resourceLesson } from "../model/autoscaling";
import { propertyRuns } from "../test/fastCheck";
import { expect, it } from "vitest";
import fc from "fast-check";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { realSnapshot } from "./units";

function start(d = waitingFixture(), scale = 1) {
  const engine = createEngine({ seed: 17, scale });
  engine.load(d);
  return engine;
}

it("holds slots, queues new arrivals, and publishes only after the logical reply", () => {
  const e = start();
  e.inject("source", 8);
  e.step(30);
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 4, queued: 4 });
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  expect(e.snapshot().nodes.result.processed).toBe(0);
  e.step(260);
  expect(e.snapshot().nodes.caller.processed).toBe(4);
  expect(e.snapshot().nodes.result.processed).toBe(4);
  e.step(1000);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
  expect(e.snapshot().nodes.caller.processed).toBe(8);
  expect(e.snapshot().inSystem).toBe(0);
});

it("uses simulation time and physical network delay, independent of animation speed", () => {
  const d = waitingFixture();
  d.edges[1].props = { travelMs: 10_000, networkDelayMs: 30 };
  const e = start(d);
  e.inject("source", 1);
  e.step(320);
  expect(e.snapshot().nodes.caller.processed, JSON.stringify(e.snapshot().events)).toBe(0);
  e.step(10);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.snapshot().particles.some((p) => p.edgeId === "call")).toBe(true);
  expect(analyzeCapacity(d).nodes.caller.capacity).toBeCloseTo(4000 / 320);
});

it("joins parallel Requests, routes nested replies and propagates the first failure upstream", () => {
  const d = waitingFixture();
  d.nodes.push({ ...d.nodes[1], id: "middle", props: { latencyMs: 10, concurrency: 4, jitter: 0 } });
  d.edges[1].to = "middle";
  d.edges.push({ id: "nested", from: "middle", to: "partner", kind: "sync" });
  const e = start(d);
  e.inject("source", 1);
  e.step(50);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(1);
  expect(e.snapshot().nodes.middle.threads?.waiting).toBe(1);
  e.setNodeStatus("partner", "down");
  e.step(500);
  expect(e.snapshot().nodes.middle.failed).toBe(1);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
  expect(e.snapshot().nodes.result.processed).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

it("waits for every parallel reply and drops siblings after fail-fast", () => {
  const d = waitingFixture();
  d.nodes.push({ ...d.nodes[2], id: "slow", props: { latencyMs: 500, jitter: 0 } });
  d.edges.push({ id: "second", from: "caller", to: "slow", kind: "sync" });
  const e = start(d);
  e.inject("source", 1);
  e.step(300);
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  expect(e.snapshot().nodes.caller.threads?.waitingOn).toEqual([["second", 1]]);
  e.step(300);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});

it("checkpoints open calls, held work, logical events and visual echoes exactly", () => {
  const e = start();
  e.inject("source", 12);
  e.step(100);
  const at = e.snapshot(),
    checkpoint = e.checkpoint();
  e.step(2000);
  const expected = e.snapshot();
  e.restore(checkpoint);
  expect(e.snapshot()).toEqual(at);
  e.step(2000);
  expect(e.snapshot()).toEqual(expected);
});

it("never leaks slots across seeded workloads, fan-out, failures or sampling", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 40 }),
      fc.integer({ min: 1, max: 16 }),
      fc.integer({ min: 1, max: 30 }),
      fc.boolean(),
      fc.constantFrom(1, 2, 10),
      fc.boolean(),
      fc.constantFrom("blocking", "non-blocking", "mixed"),
      fc.boolean(),
      (count, concurrency, duration, failing, scale, fanout, waiting, managed) => {
        const d = waitingFixture();
        d.nodes[1].props!.concurrency = concurrency * scale;
        d.edges[1].props!.caller = { wait: waiting === "blocking" ? "blocking" : "non-blocking", replyMs: 11 };
        if (managed) d.nodes[1].props!.api = { maxInFlight: concurrency * scale };
        d.nodes[2].props = { latencyMs: duration * 10, jitter: 0, status: failing ? "down" : "up" };
        if (fanout) {
          d.nodes.push({ ...d.nodes[2], id: "sibling", props: { latencyMs: 300, jitter: 0 } });
          d.edges.push({
            id: "sibling-call",
            from: "caller",
            to: "sibling",
            kind: "sync",
            props: { caller: { wait: waiting === "non-blocking" ? "non-blocking" : "blocking" } },
          });
        }
        const e = start(d, scale);
        e.inject("source", count);
        for (let i = 0; i < count + 3; i++) {
          e.step(350);
          const t = e.snapshot().nodes.caller.threads!;
          expect(t.working + t.waiting).toBeLessThanOrEqual(concurrency);
          expect(t.waiting).toBeGreaterThanOrEqual(0);
        }
        expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
        expect(e.snapshot().inSystem).toBe(0);
      },
    ),
    { numRuns: propertyRuns(60) },
  );
});

it("counts a sampled held dot as scale threads and preserves historical revisions", () => {
  const d = waitingFixture();
  const e = start(d, 2);
  e.inject("source", 4);
  e.step(30);
  expect(realSnapshot(e.snapshot()).nodes.caller.threads?.waiting).toBe(4);
  d.planning!.revision = "p3-a1";
  const legacy = start(d);
  legacy.inject("source", 1);
  legacy.step(30);
  expect(legacy.snapshot().nodes.caller.processed).toBe(1);
  expect(legacy.snapshot().nodes.caller.threads).toBeUndefined();
  expect(legacy.snapshot().edges.call.calls).toBeUndefined();
});

it("bounds deep waiting chains and unwinds every caller slot", () => {
  const d = waitingFixture();
  d.nodes = Array.from({ length: 24 }, (_, i) => ({ ...d.nodes[1], id: `n${i}`, props: { latencyMs: 10, jitter: 0 } }));
  d.edges = Array.from({ length: 23 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, kind: "sync" }));
  const e = start(d);
  e.inject("n0", 1);
  e.step(1000);
  expect(e.snapshot().nodes.n0.failed).toBe(1);
  expect(Object.values(e.snapshot().nodes).every((n) => !n.threads?.waiting)).toBe(true);
  expect(e.snapshot().inSystem).toBe(0);
});

it("returns route refusals as failures and never publishes the caller's Messages", () => {
  const d = waitingFixture();
  d.planning!.requestRoutes = [];
  d.nodes[2].stencil = "generic.adc";
  d.nodes[2].props = { routeTable: { rules: [] } };
  const e = start(d);
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().nodes.partner.rejected).toBe(1);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(e.snapshot().nodes.result.processed).toBe(0);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
});

it("retries a broker delivery after its waiting call fails, then dead-letters it", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  d.nodes[2].props = { ...d.nodes[2].props, status: "down" };
  d.nodes.push({ id: "dead", stencil: "generic.queue", label: "Failed work", x: 0, y: 0 });
  d.edges.push({ id: "deadletter", from: "source", to: "dead", props: { dlq: true, travelMs: 10 } });
  const e = start(d);
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().nodes.caller.failed).toBe(2);
  expect(e.snapshot().nodes.source.deadLettered).toBe(1);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
});

it("finishes a paused caller only on resume", () => {
  const d = waitingFixture();
  const e = start(d);
  e.inject("source", 1);
  e.step(30);
  e.setNodeStatus("caller", "paused");
  e.step(500);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(1);
  e.setNodeStatus("caller", "up");
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
});

it.each([1, 2])("keeps held calls on draining replicas and releases them at grace expiry (scale %s)", (scale) => {
  const d = waitingFixture();
  d.nodes[1].props = {
    replicas: 2,
    concurrency: 2,
    latencyMs: 10,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 1, terminationGraceMs: 50 },
  };
  d.nodes[2].props = { ...d.nodes[2].props, api: { latencyMs: 500 }, latencyMs: 500 };
  const e = start(d, scale);
  e.inject("source", 4 / scale);
  e.step(100);
  expect(e.snapshot().nodes.caller.threads!.waiting * scale).toBe(4);
  e.setNodeProps("caller", { replicas: 1 });
  e.step(40);
  expect(e.snapshot().nodes.caller.failed).toBe(0);
  e.step(20);
  // A sampled dot can span both replicas; expiry can round by at most that one dot.
  expect(e.snapshot().nodes.caller.failed * scale).toBeGreaterThanOrEqual(2);
  expect(e.snapshot().nodes.caller.failed * scale).toBeLessThanOrEqual(scale === 1 ? 2 : 2 + scale);
  e.step(1000);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

it("resets nesting depth when a completed request publishes a Message", () => {
  const d = waitingFixture();
  d.nodes = Array.from({ length: 18 }, (_, i) => ({ ...d.nodes[1], id: `n${i}`, props: { latencyMs: 10, jitter: 0 } }));
  d.nodes.push({ ...waitingFixture().nodes[2], id: "partner" });
  d.edges = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, kind: "sync" }));
  d.edges.push(
    { id: "message", from: "n16", to: "n17", props: { travelMs: 10 } },
    { id: "fresh", from: "n17", to: "partner", kind: "sync" },
  );
  const e = start(d);
  e.inject("n0", 1);
  e.step(1000);
  expect(e.snapshot().nodes.n17.processed).toBe(1);
  expect(e.snapshot().nodes.n17.failed).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

it.each([0, 1, 2])(
  "keeps an in-place retry's slot and replica after a waiting call fails (resource mode %s)",
  (mode) => {
    const d = waitingFixture();
    d.nodes[0].stencil = "generic.queue";
    d.nodes[0].props = { maxDeliveryCount: 3 };
    d.nodes[1].props = {
      ...d.nodes[1].props,
      concurrency: 1,
      latencyMs: mode === 2 ? 0 : 10,
      retry: "inplace",
      retryBackoffMs: 100,
      ...(mode ? { resources: { ...resourceLesson(), cpuMsPerMessage: mode === 2 ? 0 : 1 } } : {}),
    };
    d.nodes[2].props = { ...d.nodes[2].props, status: "down" };
    const e = start(d);
    e.inject("source", 1);
    e.step(30);
    expect(e.snapshot().nodes.caller.failed).toBe(1);
    expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 1, waiting: 0, queued: 0 });
    e.step(50);
    expect(e.snapshot().nodes.caller.inFlight).toBe(1);
    expect(e.snapshot().nodes.caller.failed).toBe(1);
    e.step(1000);
    expect(e.snapshot().nodes.caller.failed).toBe(3);
    expect(e.snapshot().nodes.caller.inFlight).toBe(0);
    expect(e.snapshot().inSystem).toBe(0);
  },
);

it("keeps animation echoes hidden until the preceding dot arrives", () => {
  const d = waitingFixture();
  d.edges[1].props = { travelMs: 10_000 };
  const e = start(d);
  e.inject("source", 1);
  e.step(300);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.frame().particles.filter((p) => p.kind === "reply")).toHaveLength(0);
  e.step(10_000);
  expect(e.frame().particles.some((p) => p.kind === "reply")).toBe(true);
});
