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

it("the cohort oracle rejects lost or duplicated outstanding weight", () => {
  const state = (outstanding: number, inFlight: boolean): LedgerInvariantState => {
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
          poolPending: [],
          cohorts: new Map([
            [
              1,
              {
                call: { branches: new Map([["call", { cohortId: 1 }]]) },
                represented: 10,
                remaining: 9,
                outstanding,
                expiresAt: 100,
                inFlight: new Set(lease ? [lease.id] : []),
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
  };
  expect(() => assertLedgerInvariants(state(10, true))).not.toThrow();
  expect(() => assertLedgerInvariants(state(9, false))).not.toThrow();
  // A dispatched member has no owner, exactly as in R-dc67a49715.
  expect.soft(() => assertLedgerInvariants(state(10, false))).toThrow("cohort outstanding weight disagrees");
  // A reply decremented outstanding while its in-flight ownership remained.
  expect.soft(() => assertLedgerInvariants(state(9, true))).toThrow("cohort outstanding weight disagrees");
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
