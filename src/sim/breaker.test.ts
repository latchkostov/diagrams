import { expect, it } from "vitest";
import { breakerPermits, breakerRecord, breakerView, createBreaker } from "./breaker";
import { callerSchema } from "../model/admissionSchema";
import { checkJsonSchema } from "../model/jsonSchema";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import type { EdgeSimProps } from "./types";
import type { DiagramFile } from "../model/types";
import { realFrame, realSnapshot } from "./units";

it("validates an empty breaker and whole-second windows, refusing unknown or invalid settings", () => {
  expect(() => checkJsonSchema({ breaker: {} }, callerSchema)).not.toThrow();
  expect(() => checkJsonSchema({ breaker: null }, callerSchema)).not.toThrow();
  for (const breaker of [{ windowMs: 1500 }, { minimumCalls: 0 }, { halfOpenCalls: 0 }, { fallback: true }])
    expect(() => checkJsonSchema({ breaker }, callerSchema)).toThrow();
});

it("counts real units, ages its window, ignores 404 and local safeguards, and lazily tests recovery", () => {
  const b = createBreaker(),
    p = { minimumCalls: 20, openMs: 1000 };
  const record = (at: number, cause: Parameters<typeof breakerRecord>[3], units = 10) => {
    const permit = breakerPermits(b, p, at, units)!;
    breakerRecord(b, p, at, cause, 30, permit);
  };
  record(0, "error");
  record(11000, "success");
  expect(b.state).toBe("closed");
  record(11000, "no-route");
  record(11000, "call-limit");
  record(11000, "breaker-open");
  expect(breakerView(b, p, 11000).calls).toBe(10);
  record(11000, "deadline");
  expect(b.state).toBe("open");
  expect(breakerPermits(b, p, 11999, 1)).toBeUndefined();
  const probe = breakerPermits(b, p, 12000, 10)!;
  expect(b.state).toBe("half-open");
  expect(breakerPermits(b, p, 12000, 10)).toBeUndefined();
  breakerRecord(b, p, 12030, "success", 30, probe);
  expect(b.state).toBe("closed");
  expect(b.buckets).toEqual([]);
});

it("reopens at the failure threshold, counts slow calls, and ignores stale probe epochs", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, slowCallMs: 20, halfOpenCalls: 2, openMs: 10 };
  breakerRecord(b, p, 20, "success", 20, breakerPermits(b, p, 0, 1)!);
  expect(b.state).toBe("open");
  const a = breakerPermits(b, p, 30, 1)!,
    c = breakerPermits(b, p, 30, 1)!;
  breakerRecord(b, p, 40, "error", 10, a);
  expect(b.state).toBe("half-open");
  breakerRecord(b, p, 40, "success", 10, c);
  expect(b.state).toBe("open");
  breakerRecord(b, p, 41, "success", 1, c);
  expect(b.state).toBe("open");
});

it("ignored or cancelled probes stay within the fixed batch and never dilute failures", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, halfOpenCalls: 3, openMs: 10 };
  breakerRecord(b, p, 0, "error", 0, breakerPermits(b, p, 0, 1)!);
  const a = breakerPermits(b, p, 10, 1)!,
    c = breakerPermits(b, p, 10, 1)!,
    d = breakerPermits(b, p, 10, 1)!;
  breakerRecord(b, p, 20, "error", 10, a);
  breakerRecord(b, p, 20, "no-route", 10, c);
  expect(b.sent).toBe(3);
  expect(breakerPermits(b, p, 20, 1)).toBeUndefined();
  breakerRecord(b, p, 20, "call-limit", 10, d);
  expect(b.state).toBe("open");
  expect(b.lastWindow).toEqual({ calls: 1, failed: 1, slow: 0 });
  expect(breakerView(b, p, 20).failurePercent).toBe(100);
  expect(b.inFlight).toBe(0);
  expect(breakerPermits(b, p, 20, 1)).toBeUndefined();
});

it("an all-ignored batch is inconclusive and waits another interval before one bounded test", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, halfOpenCalls: 1, openMs: 10 };
  breakerRecord(b, p, 0, "error", 0, breakerPermits(b, p, 0, 1)!);
  for (const time of [10, 20, 30]) {
    const permit = breakerPermits(b, p, time, 1)!;
    expect(breakerPermits(b, p, time, 1)).toBeUndefined();
    breakerRecord(b, p, time, "no-route", 0, permit);
    expect(b.state).toBe("open");
    expect(b.lastWindow).toEqual({ calls: 0, failed: 0, slow: 0 });
    expect(breakerPermits(b, p, time + 9, 1)).toBeUndefined();
  }
  breakerRecord(b, p, 40, "success", 0, breakerPermits(b, p, 40, 1)!);
  expect(b.state).toBe("closed");
});

it("R3 checks each probe's admission evidence and still rejects excess probes or open dispatch", () => {
  const state = { time: 0, inSystem: 1, edges: [], calls: [], logical: [], budgetDecisions: [] };
  const small = { state: "half-open", sent: 1, probes: 3, units: 1 };
  const narrowed = { state: "half-open", sent: 3, probes: 3, units: 2 };
  const large = { state: "half-open", sent: 11, probes: 3, units: 10 };
  expect(() => assertResilienceInvariants({ ...state, breakerDispatches: [small, narrowed] })).not.toThrow();
  // A whole cohort larger than the batch passed the former whole-dot gate; narrowing makes it an overshoot.
  expect(() => assertResilienceInvariants({ ...state, breakerDispatches: [large, small] })).toThrow("R3 probe batch");
  expect(() => assertResilienceInvariants({ ...state, breakerDispatches: [{ ...large, sent: 14 }] })).toThrow(
    "R3 probe gate",
  );
  expect(() => assertResilienceInvariants({ ...state, breakerDispatches: [{ ...small, state: "open" }] })).toThrow(
    "R3 dispatch while open",
  );
});

it("replays mixed-size probes that wait for pools without attributing a later permit to them", () => {
  // Reduced sweep seed 36167129: a queued small probe dispatches after a larger permit.
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  const [source, caller, partner, result] = d.nodes;
  source.stencil = "generic.queue";
  source.props = { maxDeliveryCount: 3 };
  d.nodes = [
    source,
    { ...caller, id: "tier0", props: { concurrency: 4, replicas: 2, latencyMs: 261, jitter: 0, failureRate: 0.5 } },
    {
      ...caller,
      id: "tier1",
      stencil: "aws.lambda",
      props: {
        concurrency: 1,
        replicas: 1,
        latencyMs: 151,
        jitter: 0,
        scaling: "fixed",
        maxConcurrency: 1,
        retry: "inplace",
        retryBackoffMs: 100,
        api: { latencyMs: 151 },
        failureRate: 0.5,
      },
    },
    { ...partner, id: "side", props: { api: { latencyMs: 20 }, jitter: 0 } },
    result,
  ];
  const policy: NonNullable<EdgeSimProps["caller"]> = {
    poolConnections: 1,
    wait: "blocking",
    replyMs: 71,
    breaker: { minimumCalls: 2, openMs: 200, halfOpenCalls: 3 },
    deadlineMs: 177,
    retry: { maxAttempts: 1, backoffMs: 0, strategy: "fixed", jitter: 0, retryOn: ["timeout"] },
  };
  d.edges = [
    { id: "input", from: "source", to: "tier0", props: { travelMs: 10 } },
    {
      id: "call0",
      from: "tier0",
      to: "tier1",
      kind: "sync",
      props: { travelMs: 10, networkDelayMs: 10, caller: policy },
    },
    {
      id: "side0",
      from: "tier0",
      to: "side",
      kind: "sync",
      props: { travelMs: 10, caller: { ...policy, wait: "non-blocking" } },
    },
    { id: "output", from: "tier0", to: "result", props: { travelMs: 10 } },
  ];
  const e = createEngine({ seed: 7, scale: 10, maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(d);
  e.inject("source", 4);
  e.setNodeStatus("tier1", "paused");
  e.step(280);
  const checkpoint = e.checkpoint();
  const finish = () => {
    e.setNodeStatus("tier1", "paused");
    e.step(350);
    e.setNodeStatus("tier0", "down");
    e.step(10);
    for (const id of ["tier0", "tier1"]) {
      e.setNodeStatus(id, "up");
      e.setNodeProps(id, { failureRate: 0 });
    }
    e.step(20000);
    expect(e.metrics().inSystem).toBe(0);
    return e.snapshot();
  };
  const expected = finish();
  e.restore(checkpoint);
  expect(finish()).toEqual(expected);
});

function fixture() {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { replicas: 1, concurrency: 10, latencyMs: 30, jitter: 0, failureRate: 1 };
  d.edges[1].props = {
    travelMs: 10,
    caller: {
      deadlineMs: 200,
      poolConnections: 1,
      breaker: { minimumCalls: 1, openMs: 1000, halfOpenCalls: 2 },
      retry: { maxAttempts: 3, backoffMs: 10, strategy: "fixed", retryOn: ["transient", "timeout"] },
    },
  };
  return d;
}

it.each([1, 2, 10])(
  "short circuits pool waiters and retries at scale %i, never dispatches open, and replays probes",
  (scale) => {
    const e = createEngine({ seed: 7, scale, verifyResilience: assertResilienceInvariants });
    e.load(fixture());
    e.inject("source", 4);
    e.step(500);
    const open = e.snapshot().edges.call;
    expect(open.breaker?.state).toBe("open");
    expect(open.calls?.shortCircuited).toBeGreaterThan(0);
    expect(open.calls?.inFlight).toBe(0);
    expect(e.queuedCalls("call")).toBe(0);
    const delivered = open.delivered;
    e.inject("source", 4);
    e.step(300);
    expect(e.snapshot().edges.call.delivered).toBe(delivered);
    e.setNodeProps("partner", { failureRate: 0 });
    e.step(300);
    e.inject("source", 4);
    e.step(20);
    const cp = e.checkpoint();
    const finish = () => {
      e.step(2000);
      return e.snapshot();
    };
    const expected = finish();
    e.restore(cp);
    expect(finish()).toEqual(expected);
    expect(expected.inSystem).toBe(0);
    expect(expected.edges.call.breaker?.probesInFlight).toBe(0);
    expect(expected.events.some((v) => v.text.includes("breaker"))).toBe(true);
  },
);

it("a breaker without retries executes only in w2", () => {
  for (const revision of ["p3-w1", "p3-w2"] as const) {
    const d = fixture();
    d.planning!.revision = revision;
    delete (d.edges[1].props!.caller as import("./types").EdgeSimProps["caller"])!.retry;
    const e = createEngine({ seed: 7, verifyResilience: assertResilienceInvariants });
    e.load(d);
    e.inject("source", 4);
    e.step(1000);
    expect(e.snapshot().edges.call.breaker?.state).toBe(revision === "p3-w2" ? "open" : undefined);
    expect(e.snapshot().inSystem).toBe(0);
  }
});

it.each([1.01, 1.5, 2.5, 10])("closes after healthy probes at fractional scale %s", (scale) => {
  const d = fixture();
  (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).breaker!.halfOpenCalls = 5;
  if (scale === 2.5 || scale === 10) {
    d.nodes[0].stencil = "generic.queue";
    d.nodes[0].props = { maxDeliveryCount: 1 };
    const consumers = scale === 10 ? 4 : 2;
    for (let i = 1; i < consumers; i++) {
      const id = `competitor-${i}`;
      d.nodes.push({ ...d.nodes[1], id });
      d.edges.push({ ...d.edges[0], id: `delivery-${i}`, to: id });
    }
    (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).breaker!.halfOpenCalls = 3;
  }
  const e = createEngine({ seed: 7, scale, verifyResilience: assertResilienceInvariants });
  e.load(d);
  e.inject("source", 10);
  e.step(1500);
  expect(e.snapshot().edges.call.breaker?.state).toBe("open");
  e.setNodeProps("partner", { failureRate: 0 });
  e.inject("source", 10);
  e.step(10000);
  expect(e.snapshot().edges.call.breaker?.state).toBe("closed");
  expect(e.snapshot().edges.call.calls?.succeeded).toBeGreaterThan(0);
});

it("settles fractional ignored, cancelled and shed probes as inconclusive", () => {
  for (const cause of ["no-route", "call-limit", "shed"] as const) {
    const b = createBreaker(),
      p = { minimumCalls: 1, halfOpenCalls: 5, openMs: 10 };
    breakerRecord(b, p, 0, "error", 0, breakerPermits(b, p, 0, 1)!);
    const permits = Array.from({ length: 3 }, () => breakerPermits(b, p, 10, 1.5)!);
    expect(breakerPermits(b, p, 10, 1.5)).toBeUndefined();
    for (const permit of permits) breakerRecord(b, p, 20, cause, 0, permit);
    expect(b.state).toBe("open");
    expect(b.lastWindow).toEqual({ calls: 0, failed: 0, slow: 0 });
    expect(breakerPermits(b, p, 29, 1.5)).toBeUndefined();
  }
});

it("rejects probes admitted without sufficient remaining room", () => {
  const state = { time: 0, inSystem: 1, edges: [], calls: [], logical: [], budgetDecisions: [] };
  for (const [sent, probes, units] of [
    [4, 3, 1],
    [13, 3, 10],
    [5.25, 5, 0.5],
    [6, 5, 1.5],
  ])
    expect(() =>
      assertResilienceInvariants({ ...state, breakerDispatches: [{ state: "half-open", sent, probes, units }] }),
    ).toThrow("R3 probe gate");
  // Room for part of the cohort, but the whole cohort was sent: the batch overshoots its test calls.
  for (const [sent, probes, units] of [
    [12, 3, 10],
    [5.5, 5, 1.5],
  ])
    expect(() =>
      assertResilienceInvariants({ ...state, breakerDispatches: [{ state: "half-open", sent, probes, units }] }),
    ).toThrow("R3 probe batch");
  for (const [sent, probes, units] of [
    [3, 3, 1],
    [5, 5, 0.5],
    [5, 5, 1.5],
  ])
    expect(() =>
      assertResilienceInvariants({ ...state, breakerDispatches: [{ state: "half-open", sent, probes, units }] }),
    ).not.toThrow();
});

it("recovers scale-three queue deliveries split between two competing consumers", () => {
  const d = fixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 1 };
  d.nodes.push({ ...d.nodes[1], id: "competitor" });
  d.edges.push({ ...d.edges[0], id: "competing", to: "competitor" });
  (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).breaker!.halfOpenCalls = 5;
  const e = createEngine({ seed: 7, scale: 3, verifyResilience: assertResilienceInvariants });
  e.load(d);
  e.inject("source", 10);
  e.step(1500);
  expect(e.snapshot().edges.call.breaker?.state).toBe("open");
  e.setNodeProps("partner", { failureRate: 0 });
  e.inject("source", 10);
  e.step(10000);
  expect(e.snapshot().edges.call.breaker?.state).toBe("closed");
});

it("half-open, narrows a cohort larger than its remaining test calls and refuses one below a real request", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, halfOpenCalls: 5, openMs: 10 };
  breakerRecord(b, p, 0, "error", 0, breakerPermits(b, p, 0, 1000)!);
  expect(b.state).toBe("open");
  const probe = breakerPermits(b, p, 10, 1000)!;
  expect(b.state).toBe("half-open");
  expect(probe).toMatchObject({ probe: true, units: 5, sent: 5 });
  expect(breakerPermits(b, p, 10, 1000)).toBeUndefined();
  breakerRecord(b, p, 40, "success", 30, probe);
  expect(b.state).toBe("closed");
  // A partial batch: 4.5 sent leaves room for less than one real request.
  const c = createBreaker();
  breakerRecord(c, p, 0, "error", 0, breakerPermits(c, p, 0, 1)!);
  const first = breakerPermits(c, p, 10, 4.5)!;
  expect(first.units).toBe(4.5);
  expect(breakerPermits(c, p, 10, 1000)).toBeUndefined();
  // Room for a whole cohort is never narrowed.
  const d = createBreaker();
  breakerRecord(d, p, 0, "error", 0, breakerPermits(d, p, 0, 1)!);
  expect(breakerPermits(d, p, 10, 3)!.units).toBe(3);
  expect(breakerPermits(d, p, 10, 3)!.units).toBe(2);
});

/** A gateway calling a failing service through a breaker at scale 100, where one dot is 100 requests. */
function narrowingFixture(caller: NonNullable<EdgeSimProps["caller"]>, routed = false): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: {
      revision: "p3-w2",
      ...(routed
        ? { requestRoutes: [{ id: "checkout", label: "Checkout", address: { method: "POST", path: "/checkout" } }] }
        : {}),
    },
    title: "Narrowed probes",
    nodes: [
      { id: "source", stencil: "client.user", label: "Clients", x: 0, y: 0, props: { ratePerSec: 0 } },
      { id: "gateway", stencil: "aws.api-gateway", label: "Gateway", x: 0, y: 0, props: { jitter: 0 } },
      {
        id: "db",
        stencil: "generic.service",
        label: "Orders",
        x: 0,
        y: 0,
        props: { replicas: 1, concurrency: 1000, latencyMs: 20, jitter: 0, failureRate: 1 },
      },
    ],
    edges: [
      {
        id: "in",
        from: "source",
        to: "gateway",
        kind: "sync",
        props: { travelMs: 10, ...(routed ? { requestRouteId: "checkout" } : {}) },
      },
      {
        id: "call",
        from: "gateway",
        to: "db",
        kind: "sync",
        props: { travelMs: 10, ...(routed ? { requestRouteId: "checkout" } : {}), caller },
      },
    ],
  };
}

it.each([10, 100])("a routed half-open recovery completes every request's route at scale %i", (scale) => {
  const e = createEngine({ seed: 7, scale, maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(narrowingFixture({ breaker: { minimumCalls: 1, openMs: 200, halfOpenCalls: 5 } }, true));
  e.inject("source", 1);
  e.step(150);
  expect(e.snapshot().edges.call.breaker?.state).toBe("open");
  e.setNodeProps("db", { failureRate: 0 });
  e.step(300);
  e.inject("source", 1);
  e.step(2000);
  const frame = realFrame(e.frame());
  expect(e.snapshot().edges.call.breaker?.state).toBe("closed");
  expect(frame.inSystem).toBe(0);
  // The narrowed test calls and the requests short-circuited beside them finish one journey each.
  expectRoutesWithinSent(frame.routes);
  expect(frame.routes?.checkout).toEqual({ sent: 2 * scale, rejected: 0, completed: 2 * scale });
});

it("queued probe resizes its existing deadline", () => {
  // openMs 0: the failure that opens the breaker drains while the pool's early turnover defers dispatch, so the
  // waiter meets the breaker half-open, with a deadline scheduled for its whole cohort.
  const e = createEngine({ seed: 7, scale: 100, maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(
    narrowingFixture({
      breaker: { minimumCalls: 1, openMs: 0, halfOpenCalls: 5 },
      deadlineMs: 1000,
      poolConnections: 1,
    }),
  );
  e.inject("source", 2);
  let narrowed = false;
  for (let t = 0; t < 300 && !narrowed; t += 10) {
    e.step(10);
    const view = e.snapshot().edges.call;
    narrowed = view.breaker?.state === "half-open" && view.breaker.probesSent === 5 && e.queuedCalls("call") === 1;
  }
  expect(narrowed).toBe(true);
  // The test calls reach a callee that now answers too late: they time out at the waiter's deadline.
  e.setNodeProps("db", { failureRate: 0, latencyMs: 8000 });
  const checkpoint = e.checkpoint();
  const finish = () => {
    e.step(3000);
    return realSnapshot(e.snapshot());
  };
  for (const snapshot of [finish(), (e.restore(checkpoint), finish())]) {
    expect(snapshot.inSystem).toBe(0);
    const calls = snapshot.edges.call.calls!;
    // Only the five test calls time out; the other 95 failed fast once, beside the first cohort's 100 failures.
    expect(calls.timedOut).toBeCloseTo(5, 9);
    expect(calls.shortCircuited).toBeCloseTo(95, 9);
    expect(calls.failed).toBeCloseTo(100 + 95 + 5, 9);
    expect(calls.attempts! + calls.shortCircuited!).toBeCloseTo(calls.requests!, 9);
  }
});

it.each([
  ["allowance 10 permits a five-request retry", 1, 5, 0],
  ["allowance 2 denies it", 0, 0, 5],
] as const)("narrowed probe spends only admitted requests from retry budget: %s", (_, minPerSec, retried, denied) => {
  const e = createEngine({ seed: 7, scale: 100, maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(
    narrowingFixture({
      breaker: { minimumCalls: 1, openMs: 100, halfOpenCalls: 5 },
      // Allowance max(minPerSec x 10, 1% of 200 requests): 10 or 2 real requests, never a whole 100-request dot.
      retry: {
        maxAttempts: 2,
        backoffMs: 0,
        strategy: "fixed",
        retryOn: ["transient"],
        budget: { percent: 1, minPerSec },
      },
    }),
  );
  e.inject("source", 1);
  e.step(150);
  const opened = realSnapshot(e.snapshot()).edges.call;
  expect(opened.breaker?.state).toBe("open");
  // The first, whole cohort's retry never fits the budget.
  expect(opened.calls?.budgetDenied).toBe(100);
  e.inject("source", 1);
  e.step(1000);
  const calls = realSnapshot(e.snapshot()).edges.call.calls!;
  expect(calls.retried).toBeCloseTo(retried, 9);
  expect(calls.budgetDenied).toBeCloseTo(100 + denied, 9);
});

/** Every route's completed journeys are a subset of the requests sent on it. */
function expectRoutesWithinSent(routes: Record<string, { sent: number; completed: number }> | undefined) {
  for (const [id, counts] of Object.entries(routes ?? {}))
    expect(counts.completed, `${id} completed <= sent`).toBeLessThanOrEqual(counts.sent + 1e-9);
}

it("a downstream route counts only admitted probe requests", () => {
  const d = narrowingFixture({ breaker: { minimumCalls: 1, openMs: 200, halfOpenCalls: 5 } }, true);
  d.planning!.requestRoutes!.push({ id: "inventory", label: "Inventory", address: { method: "GET", path: "/stock" } });
  d.nodes.push({ id: "stock", stencil: "generic.database", label: "Stock", x: 0, y: 0, props: { latencyMs: 5 } });
  d.edges.push({
    id: "reserve",
    from: "db",
    to: "stock",
    kind: "sync",
    props: { travelMs: 10, requestRouteId: "inventory" },
  });
  const e = createEngine({ seed: 7, scale: 100, maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(d);
  e.inject("source", 1);
  e.step(150);
  expect(e.snapshot().edges.call.breaker?.state).toBe("open");
  e.setNodeProps("db", { failureRate: 0 });
  e.step(300);
  // Five test calls reach Orders, which calls Stock on its own route; 95 requests fail fast at the gateway.
  e.inject("source", 1);
  e.step(2000);
  const frame = realFrame(e.frame());
  expect(frame.inSystem).toBe(0);
  expectRoutesWithinSent(frame.routes);
  expect(frame.routes?.checkout).toEqual({ sent: 200, rejected: 0, completed: 200 });
  expect(frame.routes?.inventory?.sent).toBeCloseTo(5, 9);
  expect(frame.routes?.inventory?.completed).toBeCloseTo(5, 9);
});
