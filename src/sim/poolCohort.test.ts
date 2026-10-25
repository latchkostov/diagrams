import { createEngine } from "./engine";
import { waitingFixture } from "../lab/waitingFixture";
import { expect, it } from "vitest";
import { assertLedgerInvariants, type LedgerInvariantState } from "./resourceInvariants";
import { realSnapshot } from "./units";
import { SampledLedger } from "./ledger";

it.each(["success", "failure", "rejection"] as const)(
  "a fully dispatched routed pool cohort completes only actual journeys: %s",
  (outcome) => {
    const d = waitingFixture();
    d.planning!.requestRoutes = [{ id: "lookup", address: { method: "GET", path: "/lookup" } }];
    d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
    d.nodes[2].stencil = outcome === "rejection" ? "kong" : "generic.service";
    d.nodes[2].props = {
      concurrency: 100,
      latencyMs: 10,
      jitter: 0,
      failureRate: outcome === "failure" ? 1 : 0,
      ...(outcome === "rejection" ? { routeTable: { rules: [] } } : {}),
    };
    d.edges[1].props = {
      travelMs: 200,
      requestRouteId: "lookup",
      caller: { wait: "non-blocking", poolConnections: 10, deadlineMs: 1000 },
    };
    const e = createEngine({ scale: 10, maxParticles: 0, traceHistory: 1, verifyLedger: assertLedgerInvariants });
    e.load(d);
    e.inject("source", 1);
    e.step(30);
    const dispatched = realSnapshot(e.snapshot());
    expect(dispatched.edges.call.delivered).toBe(10);
    expect(dispatched.nodes.partner.processed).toBe(0);
    expect(dispatched.routes!.lookup).toEqual({ sent: 10, completed: 0, rejected: outcome === "rejection" ? 10 : 0 });
    e.step(3000);
    const real = realSnapshot(e.snapshot());
    const completed = outcome === "success" ? 10 : 0;
    const rejected = outcome === "rejection" ? 10 : 0;
    expect(real.nodes.partner.processed).toBe(completed);
    expect(real.nodes.partner.failed).toBe(outcome === "failure" ? 10 : 0);
    expect(real.nodes.partner.rejected ?? 0).toBe(rejected);
    expect(real.routes!.lookup).toEqual({ sent: 10, completed, rejected });
    expect(real.routes!.lookup.completed + real.routes!.lookup.rejected).toBeLessThanOrEqual(10);
    expect(e.snapshot().inSystem).toBe(0);
    expect(e.tracer.recent()).toMatchObject([{ done: true }]);
  },
);

// R-9bc44a6b93: one connection sends the first member; its failure decides the caller and cancels the
// nine still queued. Cancelling that template must not complete their route.
it.each(["failure", "rejection"] as const)(
  "a partially dispatched routed cohort cancelled by its first wave completes no route: %s",
  (outcome) => {
    const d = waitingFixture();
    d.planning!.requestRoutes = [{ id: "lookup", address: { method: "GET", path: "/lookup" } }];
    d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
    d.nodes[2].stencil = outcome === "rejection" ? "kong" : "generic.service";
    d.nodes[2].props = {
      concurrency: 100,
      latencyMs: 10,
      jitter: 0,
      failureRate: outcome === "failure" ? 1 : 0,
      ...(outcome === "rejection" ? { routeTable: { rules: [] } } : {}),
    };
    d.edges[1].props = {
      travelMs: 200,
      requestRouteId: "lookup",
      caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 },
    };
    const e = createEngine({ scale: 10, maxParticles: 0, traceHistory: 1, verifyLedger: assertLedgerInvariants });
    e.load(d);
    e.inject("source", 1);
    e.step(3000);
    const real = realSnapshot(e.snapshot());
    expect(real.edges.call.delivered).toBe(1);
    expect(real.nodes.partner.failed).toBe(outcome === "failure" ? 1 : 0);
    expect(real.nodes.partner.rejected ?? 0).toBe(outcome === "rejection" ? 1 : 0);
    expect(real.nodes.caller).toMatchObject({ processed: 0, failed: 10 });
    expect(real.edges.call.calls).toMatchObject({ failed: 10, timedOut: 0, late: 0, inFlight: 0 });
    expect(real.routes!.lookup).toEqual({ sent: 10, completed: 0, rejected: outcome === "rejection" ? 1 : 0 });
    expect(e.snapshot().inSystem).toBe(0);
    expect(e.tracer.recent()).toMatchObject([{ done: true }]);
  },
);

// R-0960b75fb2: the first wave succeeds, so the caller is done; the second wave fails. Only that wave
// fails on the edge: the eight unsent members stay queued under the shared deadline and are delivered.
it("an orphan's failed wave keeps the rest of its cohort queued and settling", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 5000 } };
  const e = createEngine({ scale: 10, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 1);
  // One member per 20 ms: the first is processed by 40 ms, the second between 40 and 60 ms.
  e.step(40);
  expect(realSnapshot(e.snapshot()).nodes.partner.processed).toBe(1);
  e.setNodeProps("partner", { failureRate: 1 });
  e.step(20);
  e.setNodeProps("partner", { failureRate: 0 });
  const orphaned = realSnapshot(e.snapshot());
  expect(orphaned.nodes.caller.processed).toBe(10);
  expect(orphaned.nodes.partner).toMatchObject({ processed: 1, failed: 1 });
  e.step(3000);
  const real = realSnapshot(e.snapshot());
  expect(real.nodes.caller).toMatchObject({ processed: 10, failed: 0 });
  expect(real.nodes.partner).toMatchObject({ processed: 9, failed: 1 });
  expect(real.edges.call.delivered).toBe(10);
  expect(real.edges.call.calls).toMatchObject({ failed: 1, timedOut: 0, late: 0, inFlight: 0 });
  expect(e.snapshot().inSystem).toBe(0);
});

/** One bound cohort of ten with nine unsent; `queued` is how many dispatch-queue entries hold its template. */
function cohortState(outstanding: number, inFlight: boolean, queued = 1): LedgerInvariantState {
  const template = {};
  const ledger = new SampledLedger();
  const lease = inFlight
    ? ledger.reserve({ owner: "caller", scope: "pool", edge: "call", startActive: 0 }, 1, 1)!
    : undefined;
  return {
    time: 0,
    ledger: ledger.state,
    nodes: [{ id: "caller", activeMs: 0 }],
    edges: [
      {
        id: "call",
        poolUsed: lease?.weight ?? 0,
        poolLeases: new Map(),
        poolPending: Array.from({ length: queued }, () => ({ message: template })),
        cohorts: new Map([
          [
            1,
            {
              call: { branches: new Map([["call", { cohortId: 1 }]]) },
              state: "bound",
              template,
              represented: 10,
              remaining: 9,
              outstanding,
              expiresAt: 100,
              inFlight: new Map(lease ? [[lease.id, lease.represented]] : []),
            },
          ],
        ]),
      },
    ],
    inSystem: 0,
    admissionInFlight: new Map(),
    partBudget: { used: 0, blocked: false },
    logical: [],
  };
}

it("the cohort oracle rejects lost or duplicated outstanding weight", () => {
  expect(() => assertLedgerInvariants(cohortState(10, true))).not.toThrow();
  expect(() => assertLedgerInvariants(cohortState(9, false))).not.toThrow();
  // A dispatched member has no owner, exactly as in R-dc67a49715.
  expect.soft(() => assertLedgerInvariants(cohortState(10, false))).toThrow("cohort outstanding weight disagrees");
  // A reply decremented outstanding while its in-flight ownership remained.
  expect.soft(() => assertLedgerInvariants(cohortState(9, true))).toThrow("cohort outstanding weight disagrees");
});

// R-9bba034378: unsent members can only dispatch from the queue, so an unexpired cohort with any must hold
// exactly one queued template.
it("oracle rejects an unsent cohort without a queued template", () => {
  expect(() => assertLedgerInvariants(cohortState(10, true, 1))).not.toThrow();
  expect
    .soft(() => assertLedgerInvariants(cohortState(10, true, 0)))
    .toThrow("unsent cohort members left the dispatch queue");
  expect
    .soft(() => assertLedgerInvariants(cohortState(10, true, 2)))
    .toThrow("unsent cohort members left the dispatch queue");
});

// R-21c7562a21, quarantined (docs/backlog/2026-10-25-cohort-shedding-timeouts.md). Ten connections send
// all ten members to a paused callee whose queue holds one; it sheds nine, which fail on the edge. Only the
// retained member should time out, as at scale 1: 1 timeout, 10 failures.
function shedAtDeadline(scale: number, options: { shedCohorts?: boolean; live?: "add" | "add, then remove" } = {}) {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 10, jitter: 0, status: "paused" };
  if (!options.live) d.nodes[2].props.queue = { limit: 1 };
  d.edges[1].props = { travelMs: 200, caller: { wait: "non-blocking", poolConnections: 10, deadlineMs: 1000 } };
  const e = createEngine({
    scale,
    maxParticles: 0,
    shedCohorts: options.shedCohorts,
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.inject("source", 10 / scale);
  if (options.live) {
    // The cohort opened without a queue and its wave is still travelling when the callee gains one.
    e.step(100);
    e.setNodeProps("partner", { queue: { limit: 1 } });
    if (options.live === "add, then remove") {
      e.step(400);
      e.setNodeProps("partner", { queue: undefined });
    }
  }
  e.step(3000);
  const real = realSnapshot(e.snapshot());
  return { calls: real.edges.call.calls, delivered: real.edges.call.delivered, shed: real.nodes.partner.shed };
}
const shedReference = {
  calls: { inFlight: 0, held: 0, timedOut: 1, failed: 10, late: 0 },
  delivered: 10,
  shed: 9,
};

it.each([1, 10])("a pooled call to a shedding queue keeps whole-dot deadline accounting at scale %d", (scale) => {
  expect(shedAtDeadline(scale)).toEqual(shedReference);
});

// R-8e6e356e3c: the guard only applies when a cohort opens. A bound cohort's expiry settles its caller at
// no more than its branch size, which the shed narrowed, so it matches the guarded scale-1 numbers.
it.each(["add", "add, then remove"] as const)(
  "a queue enabled mid-flight sheds a bound cohort's wave without counting it again at expiry: %s",
  (live) => {
    expect(shedAtDeadline(1, { live })).toEqual(shedReference);
    expect(shedAtDeadline(10, { live })).toEqual(shedReference);
  },
);

it("a cohort's partially shed members leave its timeout accounting", () => {
  expect(shedAtDeadline(10, { shedCohorts: true })).toEqual(shedReference);
});

// The remaining quarantined gap: after an OK first wave, a shed wave's members never count as edge
// failures. At scale 1 (18 shed, 18 failed) and on the guarded path (9 and 9) every shed member fails.
function orphanShed() {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 50, jitter: 0, queue: { limit: 1 } };
  d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 5, deadlineMs: 2000 } };
  const e = createEngine({ scale: 10, maxParticles: 0, shedCohorts: true, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 2);
  e.step(4000);
  const real = realSnapshot(e.snapshot());
  expect(e.snapshot().inSystem).toBe(0);
  return { failed: real.edges.call.calls!.failed, shed: real.nodes.partner.shed };
}

it("the quarantined orphan shed path currently counts no edge failure for its shed members", () => {
  expect(orphanShed()).toEqual({ failed: 0, shed: 8 });
});

it.fails("R-21c7562a21: an orphan's partially shed members fail on the edge", () => {
  expect(orphanShed()).toEqual({ failed: 8, shed: 8 });
});

it("a burst grants only available connections; a full pool never grants zero-weight work", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 } };
  const grants = new Map<number, number>();
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyLedger({ ledger }) {
      for (const lease of ledger.reservations.values())
        if (lease.scope === "pool") grants.set(lease.id, lease.represented);
    },
  });
  e.load(d);
  e.inject("source", 2);
  e.step(100);
  expect([...grants.values()]).toEqual([1]);
});

it("a fractional remainder is dispatched at its exact weight", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 1, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 } };
  const grants = new Map<number, number>();
  const e = createEngine({
    scale: 2.5,
    maxParticles: 0,
    verifyLedger({ ledger }) {
      for (const lease of ledger.reservations.values())
        if (lease.scope === "pool") grants.set(lease.id, lease.represented);
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  expect([...grants.values()]).toEqual([2, 0.5]);
});

it.each([
  { deadlineMs: 22, poolConnections: 1, represented: 3 },
  { deadlineMs: 20, poolConnections: 1, represented: 2 },
  { deadlineMs: 20, poolConnections: 2, represented: 4 },
])(
  "each connection grants one creation tick per tick before expiry: $deadlineMs/$poolConnections",
  ({ deadlineMs, poolConnections, represented }) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 1, latencyMs: 10, jitter: 0 };
    d.edges[1].props = { caller: { wait: "non-blocking", poolConnections, deadlineMs } };
    const grants = new Map<number, { represented: number; weight: number }>();
    const e = createEngine({
      scale: 10,
      maxParticles: 0,
      verifyLedger({ ledger }) {
        for (const lease of ledger.reservations.values())
          if (lease.scope === "pool") grants.set(lease.id, { represented: lease.represented, weight: lease.weight });
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(100);
    expect([...grants.values()]).toEqual([{ represented, weight: poolConnections }]);
  },
);

it.each([
  { scale: 10, concurrency: 10, latencyMs: 10, granted: 1 },
  { scale: 10, concurrency: 1, latencyMs: 10, granted: 10 },
  { scale: 10, concurrency: 1, latencyMs: 0, granted: 1 },
  { scale: 2.5, concurrency: 1, latencyMs: 10, granted: 2 },
])(
  "only existing local thread waves widen a pool grant: $scale/$concurrency/$latencyMs",
  ({ scale, concurrency, latencyMs, granted }) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency, latencyMs, jitter: 0 };
    d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 } };
    const grants = new Map<number, number>();
    const e = createEngine({
      scale,
      maxParticles: 0,
      verifyLedger({ ledger }) {
        for (const lease of ledger.reservations.values())
          if (lease.scope === "pool") grants.set(lease.id, lease.represented);
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(100);
    expect([...grants.values()]).toEqual([granted]);
  },
);
