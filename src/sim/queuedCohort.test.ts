import type { EdgeSimProps } from "./types";
import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine, observeEngineEvents } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, type LedgerInvariantState } from "./resourceInvariants";
import { realSnapshot } from "./units";

function fixture(deadlineMs = 600) {
  const diagram = waitingFixture();
  diagram.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  diagram.edges[1].props = {
    caller: { wait: "non-blocking", poolConnections: 1, deadlineMs, replyMs: 10 },
  };
  return diagram;
}

it("preserves a positive pooled tail smaller than the rounding allowance", () => {
  const d = fixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 20, jitter: 0 };
  const scale = 1 + 5e-10;
  const e = createEngine({ scale, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  let processed = 0;
  const stop = observeEngineEvents(e, (event) => {
    if (event.kind === "process" && event.nodeId === "partner") processed++;
  });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  stop();
  expect(processed).toBe(2);
  const real = realSnapshot(e.snapshot());
  expect(real.nodes.partner.processed).toBe(scale);
  expect(real.edges.call.delivered).toBe(scale);
  expect(real.edges.call.calls).toMatchObject({ timedOut: 0, late: 0, inFlight: 0 });
  expect(e.snapshot().inSystem).toBe(0);
});

it("an OK first wave keeps the cohort's queue place and restores orphan replies and expiry", () => {
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(fixture());
  e.inject("source", 2);
  e.step(400);
  const edge = () => [...state.edges].find((edge) => edge.id === "call")!;
  expect(edge().cohorts!.size).toBe(2);
  const checkpoint = e.checkpoint();
  const finish = () => {
    e.step(3600);
    const real = realSnapshot(e.snapshot());
    expect(real.edges.call.calls).toMatchObject({ timedOut: 18, failed: 18, late: 1, inFlight: 0 });
    expect(real.nodes.partner.processed).toBe(3);
    expect(real.edges.call.delivered).toBe(3);
    expect(e.snapshot().inSystem).toBe(0);
    expect(edge().cohorts!.size).toBe(0);
    expect(state.ledger.reservations.size).toBe(0);
    return e.snapshot();
  };
  const expected = finish();
  e.restore(checkpoint);
  expect(finish()).toEqual(expected);
});

it.each(["blocking", "non-blocking"] as const)(
  "a %s cohort frees its pool at expiry without sending its cancelled tail",
  (wait) => {
    const d = fixture(100);
    (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).wait = wait;
    let state!: LedgerInvariantState;
    const e = createEngine({
      scale: 10,
      maxParticles: 0,
      verifyLedger(s) {
        state = s;
        assertLedgerInvariants(s);
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(130);
    const real = realSnapshot(e.snapshot());
    expect(real.edges.call.delivered).toBe(1);
    expect(real.edges.call.calls).toMatchObject({ timedOut: 10, failed: 10, inFlight: 0 });
    expect([...state.ledger.reservations.values()].filter((r) => r.scope === "pool")).toHaveLength(0);
    e.step(1000);
    expect(realSnapshot(e.snapshot()).edges.call.calls!.late).toBe(1);
    expect(e.snapshot().inSystem).toBe(0);
  },
);

it("an unpooled child replies to its partial parent's own pool delivery", () => {
  const d = fixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.nodes.push({ ...d.nodes[2], id: "child" });
  d.edges.push({ id: "nested", from: "partner", to: "child", kind: "sync" });
  const e = createEngine({ scale: 10, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 1);
  e.step(3000);
  const real = realSnapshot(e.snapshot());
  expect(real.edges.call.calls).toMatchObject({ timedOut: 0, failed: 0, late: 0, inFlight: 0 });
  expect(real.nodes.partner.processed).toBe(10);
  expect(real.nodes.child.processed).toBe(10);
  expect(e.snapshot().inSystem).toBe(0);
});

// Reduced from resilience sweep seed -951583504. An orphan timeout must not
// reopen the breaker after the caller's successful first wave was recorded.
it("fractional healthy probes close the breaker independently of an orphan's later deadline", () => {
  const d = fixture(200);
  d.planning!.revision = "p3-w2";
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { replicas: 1, concurrency: 10, latencyMs: 30, jitter: 0, failureRate: 1 };
  (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).breaker = {
    minimumCalls: 1,
    openMs: 1000,
    halfOpenCalls: 2,
  };
  const e = createEngine({ seed: 7, scale: 4.000000001, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 4);
  e.step(1000);
  expect(e.snapshot().edges.call.breaker?.state).toBe("open");
  e.setNodeProps("partner", { failureRate: 0 });
  for (let i = 0; i < 3; i++) {
    e.inject("source", 1);
    e.step(1000);
  }
  expect(e.snapshot().edges.call.breaker?.state).toBe("closed");
});

// Reduced from seed -1327591624: the second caller initially gets half a
// connection while the first owns 1.5. Its first reply must keep that grant's
// admission evidence when failing the caller's entire cohort.
it("a failed sub-request pool grant retains its original admission evidence", () => {
  const d = fixture(200);
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 30, jitter: 0, failureRate: 1 };
  (d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>).poolConnections = 2;
  const e = createEngine({ scale: 1.5, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 2);
  e.step(3000);
  expect(realSnapshot(e.snapshot()).nodes.caller.failed).toBe(3);
  expect(e.snapshot().inSystem).toBe(0);
});

it("a logical reply before a sub-tick deadline wins when both drain in the same tick", () => {
  const d = fixture(22);
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 1, jitter: 0 };
  d.edges[1].props!.networkDelayMs = 1;
  const e = createEngine({ scale: 10, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  const real = realSnapshot(e.snapshot());
  expect(real.nodes.caller.processed).toBe(10);
  expect(real.edges.call.calls).toMatchObject({ timedOut: 9, failed: 9, late: 0, inFlight: 0 });
  expect(e.snapshot().inSystem).toBe(0);
});

it("a failed pool wave preserves its charged occupancy across a live scale edit and replay", () => {
  const d = fixture(200);
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 30, jitter: 0, failureRate: 1 };
  const e = createEngine({ scale: 1.5, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 1);
  e.step(30);
  e.setScale(1);
  const checkpoint = e.checkpoint();
  e.step(3000);
  const expected = e.snapshot();
  expect(expected.nodes.caller.failed).toBeGreaterThan(0);
  expect(expected.inSystem).toBe(0);
  e.restore(checkpoint);
  e.step(3000);
  expect(e.snapshot()).toEqual(expected);
});

it("records the first wave's breaker result before waking the next pooled cohort", () => {
  const d = fixture(1000);
  d.planning!.revision = "p3-w2";
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 20, jitter: 0, failureRate: 1 };
  const caller = d.edges[1].props!.caller as NonNullable<EdgeSimProps["caller"]>;
  caller.poolConnections = 5;
  caller.breaker = { minimumCalls: 1, openMs: 0, halfOpenCalls: 10 };
  const e = createEngine({ scale: 10, maxParticles: 0, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 3);
  e.step(60);
  expect(e.snapshot().edges.call.breaker?.state).toBe("half-open");
  e.setNodeProps("partner", { failureRate: 0 });
  e.step(2000);
  const real = realSnapshot(e.snapshot());
  expect(real.edges.call.calls!.shortCircuited).toBe(0);
  expect(real.nodes.caller).toMatchObject({ processed: 20, failed: 10 });
  expect(real.edges.call.delivered).toBe(25);
  expect(e.snapshot().inSystem).toBe(0);
});
