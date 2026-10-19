import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { settleOnce, raceReply, type Attempt } from "./attempt";
import { createEngine } from "./engine";
import {
  assertLedgerInvariants,
  assertOutcomeInvariants,
  assertResourceInvariants,
  type LedgerInvariantState,
} from "./resourceInvariants";
import { waitingFixture } from "../lab/waitingFixture";
import { cloudFixture } from "../lab/cloudFixture";
import { resourceLesson } from "../model/autoscaling";
import { arbWaitDiagram } from "../test/waitScenarios";
import { propertyRuns } from "../test/fastCheck";
import type { EngineOptions } from "./types";
import { realSnapshot } from "./units";

it("a saturated non-blocking caller preserves master's local-work throughput at scales 1 and 10", () => {
  const run = (scale: number) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 1, latencyMs: 100, jitter: 0 };
    d.nodes[2].props = { api: { latencyMs: 0 }, jitter: 0 };
    d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking" } };
    const e = createEngine({ scale, seed: 7, maxParticles: 0, verifyLedger: assertLedgerInvariants });
    e.load(d);
    e.inject("source", 1000);
    e.step(20_000);
    return realSnapshot(e.snapshot()).nodes.caller.processed;
  };
  const baseline = run(1);
  const sampled = run(10);
  // I1, S=1, N=10, no faults; the master probe is checked alongside this regression.
  const tolerance = 10 * (Math.ceil(1 / 10) + 1) + 0.02 * baseline;
  expect(baseline).toBe(180);
  expect(Math.abs(sampled - baseline)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(sampled - 180)).toBeLessThanOrEqual(tolerance);
});

it.each([1, 10])("pause → reply → down fails an unexecuted continuation, preserving the join (scale %s)", (scale) => {
  const d = waitingFixture();
  d.edges[0].kind = "sync";
  d.edges[0].props = { travelMs: 10, networkDelayMs: 10 };
  d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking", replyMs: 1000 } };
  const outcomes = new Map<number, { ok: boolean; at: number }>();
  const e = createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      for (const a of s.attempts) if (a.node === "caller" && a.outcome) outcomes.set(a.id, a.outcome);
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(50);
  e.setNodeStatus("caller", "paused");
  e.step(300);
  expect([...outcomes.values()].map((o) => o.ok)).toEqual([true]);
  const joined = [...outcomes.values()][0];
  e.setNodeStatus("caller", "down");
  e.step(2000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 0, failed: 1 });
  expect(e.snapshot().nodes.result.processed).toBe(0);
  expect(e.snapshot().edges.input.calls?.failed).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
  expect([...outcomes.values()]).toEqual([joined, { ok: false, code: undefined, at: 350 }]);
});

it("managed admission rejections commit a failed outcome without becoming processing failures", () => {
  const d = waitingFixture();
  d.nodes[1].stencil = "generic.external-api";
  d.nodes[1].props = { api: { maxInFlight: 1, latencyMs: 100 }, jitter: 0 };
  const outcomes = new Map<number, boolean>();
  const e = createEngine({
    seed: 7,
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      for (const a of s.attempts) if (a.node === "caller" && a.committed) outcomes.set(a.id, a.outcome!.ok);
    },
  });
  e.load(d);
  e.inject("source", 2);
  e.step(1000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, rejected: 1, failed: 0 });
  expect([...outcomes.values()].sort()).toEqual([false, true]);
});

it.each(["pause", "down", "drain", "scale", "checkpoint"])(
  "sampled non-blocking local-work reservations survive their logical dispatch: %s",
  (action) => {
    const d = waitingFixture();
    d.nodes[1].props = {
      concurrency: 1,
      replicas: 2,
      latencyMs: 100,
      jitter: 0,
      ...(action === "scale"
        ? {}
        : {
            resources: {
              ...resourceLesson(),
              cpuMsPerMessage: 0,
              terminationGraceMs: 10,
              startup: { delayMs: 0, jitterFraction: 0 },
            },
          }),
    };
    d.nodes[2].props = { api: { latencyMs: 2000 }, jitter: 0 };
    d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking" } };
    let state!: LedgerInvariantState;
    const e = createEngine({
      scale: 10,
      seed: 7,
      maxParticles: 0,
      verifyResources: assertResourceInvariants,
      verifyOutcomes: assertOutcomeInvariants,
      verifyLedger(s) {
        assertLedgerInvariants(s);
        state = s;
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(200);
    const threads = () => [...state.ledger.reservations.values()].filter((r) => r.scope === "thread");
    expect(e.snapshot().edges.call.delivered).toBe(1);
    expect(threads()).toHaveLength(1);
    expect(e.snapshot().nodes.caller.threads?.working).toBeGreaterThan(0);
    if (action === "pause") {
      const at = threads()[0].releaseAt;
      e.setNodeStatus("caller", "paused");
      e.step(1000);
      expect(threads()[0].releaseAt).toBe(at);
      e.setNodeStatus("caller", "up");
    } else if (action === "down") e.setNodeStatus("caller", "down");
    else if (action === "drain") e.setNodeProps("caller", { replicas: 1 });
    else if (action === "scale") e.setScale(1);
    else {
      const checkpoint = e.checkpoint();
      e.step(3000);
      const expected = e.snapshot();
      e.restore(checkpoint);
      e.step(3000);
      expect(e.snapshot()).toEqual(expected);
    }
    e.step(action === "down" || action === "drain" ? 10 : 1000);
    expect(threads()).toHaveLength(0);
    e.step(30_000);
    expect(state.ledger.reservations.size).toBe(0);
    expect(state.partBudget.used).toBe(0);
    expect(e.snapshot().inSystem).toBe(0);
    expect(e.snapshot().nodes.caller.failed).toBe(action === "down" ? 1 : 0);
  },
);

it("settleOnce writes exactly one outcome, including its code and logical time", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          ok: fc.boolean(),
          code: fc.option(fc.integer({ min: 400, max: 599 }), { nil: undefined }),
          at: fc.nat(1000),
        }),
        { minLength: 1 },
      ),
      (outcomes) => {
        const a: Attempt = { id: 1, node: "worker", message: {}, admittedAt: 0, committed: false, res: {} };
        expect(outcomes.filter((o) => settleOnce(a, o.ok, o.code, o.at))).toHaveLength(1);
        expect(a.outcome).toEqual(outcomes[0]);
      },
    ),
    { numRuns: propertyRuns(40) },
  );
});

it("raceReply gives the deadline every tie, even before the deadline event is popped", () => {
  expect(raceReply({ expiresAt: 100 }, 99)).toBe("reply");
  expect(raceReply({ expiresAt: 100 }, 100)).toBe("timeout");
  expect(raceReply({ expiresAt: 100 }, 101)).toBe("timeout");
});

function answered(resources = false) {
  const diagram = waitingFixture();
  diagram.groups = [{ id: "region", label: "Region", x: 300, y: 150, width: 250, height: 250 }];
  diagram.nodes[1].group = "region";
  diagram.edges[0].kind = "sync";
  diagram.edges[0].props = { travelMs: 10, networkDelayMs: 10 };
  diagram.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1 } };
  diagram.nodes[1].props = {
    concurrency: 1,
    latencyMs: 10,
    jitter: 0,
    ...(resources
      ? {
          replicas: 2,
          resources: {
            ...resourceLesson(),
            cpuMsPerMessage: 0,
            terminationGraceMs: 10,
            startup: { delayMs: 0, jitterFraction: 0 },
          },
        }
      : {}),
  };
  diagram.nodes[2].props = { api: { latencyMs: 100 }, jitter: 0 };
  let state!: LedgerInvariantState;
  const engine = createEngine({
    seed: 7,
    scale: 10,
    maxParticles: 0,
    verifyLedger(s) {
      assertLedgerInvariants(s);
      state = s;
    },
    verifyOutcomes: assertOutcomeInvariants,
  });
  engine.load(diagram);
  engine.inject("source", 1);
  engine.step(200);
  return { diagram, engine, state: () => state };
}

it("review 075404 #2: an answered success cannot be reversed by a later down", () => {
  const { engine } = answered();
  expect(engine.snapshot().nodes.caller.processed).toBe(1);
  expect(engine.snapshot().nodes.source.latency?.samples).toBe(1);
  expect(engine.snapshot().nodes.result.processed).toBe(1);
  expect(engine.snapshot().nodes.caller.inFlight).toBeGreaterThan(0);
  const before = engine.snapshot();
  engine.setNodeStatus("caller", "down");
  engine.step(3000);
  const after = engine.snapshot();
  expect(after.nodes.caller.processed).toBe(before.nodes.caller.processed);
  expect(after.nodes.caller.failed).toBe(0);
  expect(after.nodes.result.processed).toBe(1);
  expect(after.edges.input.calls?.failed).toBe(0);
  expect(after.inSystem).toBe(0);
});

it.each(["down", "drain", "outage"])("%s after answer only releases the answered attempt's resources", (fault) => {
  const { engine, state } = answered(fault === "drain");
  expect(engine.snapshot().nodes.caller.processed).toBe(1);
  expect(engine.snapshot().nodes.caller.inFlight).toBeGreaterThan(0);
  if (fault === "down") engine.setNodeStatus("caller", "down");
  else if (fault === "drain") engine.setNodeProps("caller", { replicas: 1 });
  else engine.setFault({ kind: "boundary", boundary: "region", down: true });
  engine.step(10);
  expect(engine.snapshot().nodes.caller.inFlight).toBe(0);
  if (fault !== "drain") expect(engine.snapshot().nodes.caller.status).toBe("down");
  engine.step(3000);
  expect(engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0, inFlight: 0 });
  expect(engine.snapshot().nodes.result.processed).toBe(1);
  expect(state().ledger.reservations.size).toBe(0);
  expect(state().partBudget.used).toBe(0);
});

it("a reply decided while paused commits once on resume, even if down follows", () => {
  const { engine } = answered();
  engine.reset();
  engine.inject("source", 1);
  engine.step(50);
  engine.setNodeStatus("caller", "paused");
  engine.step(200);
  expect(engine.snapshot().nodes.caller.processed).toBe(0);
  engine.setNodeStatus("caller", "up");
  expect(engine.snapshot().nodes.caller.processed).toBe(1);
  engine.setNodeStatus("caller", "down");
  engine.step(3000);
  expect(engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
});

it.each([false, true])(
  "I7 reduced mixed-call probe: a continuation takes over its own retained thread (resource failure=%s)",
  (resourceFailure) => {
    // Reduced from property seed 823620404. The old hold used to block the
    // continuation until t=310 even though the last logical reply arrived at t=40.
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
    d.nodes[2].stencil = "generic.service";
    d.nodes[2].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
    d.nodes.push({
      ...d.nodes[2],
      id: "side",
      stencil: "generic.external-api",
      props: { api: { latencyMs: 20 }, jitter: 0 },
    });
    if (resourceFailure)
      Object.assign(d.nodes[2].props!, {
        failureRate: 1,
        resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
      });
    d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1 } };
    d.edges.push({
      id: "side-call",
      from: "caller",
      to: "side",
      kind: "sync",
      props: { travelMs: 10, caller: { poolConnections: 1, wait: "non-blocking" } },
    });
    const e = createEngine({
      scale: 10,
      maxParticles: 0,
      verifyLedger: assertLedgerInvariants,
      verifyOutcomes: assertOutcomeInvariants,
      verifyResources: assertResourceInvariants,
    });
    e.load(d);
    e.inject("source", 1);
    e.step(60);
    expect(e.snapshot().nodes.caller.processed).toBe(resourceFailure ? 0 : 1);
    expect(e.snapshot().nodes.caller.failed).toBe(resourceFailure ? 1 : 0);
    expect(e.snapshot().nodes.result.processed).toBe(resourceFailure ? 0 : 1);
    expect(e.snapshot().nodes.caller.inFlight).toBe(1);
    e.step(1000);
    expect(e.snapshot().nodes.caller.inFlight).toBe(0);
  },
);

it("the outcome oracle rejects an overwritten outcome and a second commit transition", () => {
  const a: Attempt = { id: 1, node: "worker", message: {}, admittedAt: 0, committed: false, res: {} };
  settleOnce(a, true, undefined, 10);
  assertOutcomeInvariants({ time: 10, attempts: [a] });
  a.outcome = { ok: false, at: 10 };
  expect(() => assertOutcomeInvariants({ time: 10, attempts: [a] })).toThrow("changed after settlement");
  a.outcome = { ok: true, code: undefined, at: 10 };
  a.committed = true;
  assertOutcomeInvariants({ time: 10, attempts: [a] });
  a.committed = false;
  expect(() => assertOutcomeInvariants({ time: 10, attempts: [a] })).toThrow("changed after settlement");
});

it("an in-place retry takes over the reservation and adds the previous attempt's hold", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 10,
    jitter: 0,
    retry: "inplace",
    retryBackoffMs: 100,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.edges[1].props = { travelMs: 10 };
  d.nodes[2].props = { api: { latencyMs: 250, errorRate: 1 }, jitter: 0 };
  let parts: unknown;
  const owners = new Set<unknown>();
  const outcomes = new Map<number, boolean>();
  const e = createEngine({
    seed: 7,
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      for (const n of s.nodes)
        if (n.id === "caller")
          for (const w of n.working) {
            if (parts === undefined) parts = w.cpuParts;
            expect(w.cpuParts).toBe(parts);
            owners.add(w);
          }
    },
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      for (const a of s.attempts) if (a.node === "caller" && a.outcome) outcomes.set(a.id, a.outcome.ok);
    },
  });
  e.load(d);
  e.inject("source", 1);
  for (let tick = 0; tick < 100 && !e.snapshot().nodes.caller.failed; tick++) e.step(10);
  expect(e.snapshot().nodes.caller).toMatchObject({ failed: 1, inFlight: 1 });
  e.setNodeProps("partner", { api: { latencyMs: 250, errorRate: 0 } });
  for (let tick = 0; tick < 100 && !e.snapshot().nodes.caller.processed; tick++) e.step(10);
  expect(e.snapshot().nodes.caller).toMatchObject({ failed: 1, processed: 1 });
  expect([...outcomes.values()]).toEqual([false, true]);
  expect(owners.size).toBe(1);
  const settledAt = e.metrics().time;
  e.step(7 * settledAt);
  expect(e.snapshot().nodes.caller.inFlight).toBe(1);
  e.step(10 * settledAt);
  expect(e.snapshot().nodes.caller.inFlight).toBe(0);
  expect(e.metrics().inSystem).toBe(0);
});

it("an acknowledged broker tail never becomes request-scaler waiting pressure", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  const worker = cloudFixture("app-service").nodes[1];
  d.nodes[1].stencil = worker.stencil;
  d.nodes[1].props = {
    ...worker.props,
    concurrency: 1,
    latencyMs: 10,
    jitter: 0,
    resources: {
      ...resourceLesson(),
      modelRevision: "a2",
      cpuMsPerMessage: 0,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  let waiting: number | undefined;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      for (const n of s.nodes) if (n.id === "caller") waiting = n.fleet?.samples.at(-1)?.waiting;
    },
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.snapshot().nodes.caller.inFlight).toBeGreaterThan(0);
  expect(waiting).toBe(0);
});

it("I7: spaced logical outcomes are independent of ledger holds", () => {
  fc.assert(
    fc.property(arbWaitDiagram, fc.boolean(), ({ diagram, scale }, failing) => {
      diagram = structuredClone(diagram);
      if (failing) diagram.nodes[2].props!.failureRate = 1;
      const probe = (ledgerHold?: EngineOptions["ledgerHold"]) => {
        let holds = 0;
        const trace: unknown[] = [];
        const seen = new Set<number>();
        const e = createEngine({
          seed: 19,
          scale,
          ledgerHold,
          maxParticles: 0,
          verifyResources: assertResourceInvariants,
          verifyLedger(s) {
            assertLedgerInvariants(s);
            holds = s.ledger.reservations.size;
          },
          verifyOutcomes(s) {
            assertOutcomeInvariants(s);
            for (const a of s.attempts)
              if (a.outcome && !seen.has(a.id)) {
                seen.add(a.id);
                trace.push({ id: a.id, node: a.node, outcome: a.outcome });
              }
          },
        });
        e.load(diagram);
        return { e, trace, holds: () => holds };
      };
      const probes = [probe(), probe("none")];
      for (let i = 0; i < 3; i++) {
        for (const p of probes) p.e.inject("source", 1);
        let idle = false;
        for (let tick = 0; tick < 3000 && !idle; tick++) {
          for (const p of probes) p.e.step(10);
          idle = probes.every(
            (p) =>
              !p.e.metrics().inSystem && !p.holds() && Object.values(p.e.snapshot().nodes).every((n) => !n.inFlight),
          );
        }
        expect(idle).toBe(true);
        expect(probes[0].trace.length).toBeGreaterThan(0);
        expect(probes[0].trace).toEqual(probes[1].trace);
      }
    }),
    { numRuns: propertyRuns(40) },
  );
});

it("drained checkpoints keep no attempt history", () => {
  const { engine } = answered();
  engine.step(3000);
  const clone = vi.spyOn(globalThis, "structuredClone");
  engine.checkpoint();
  const graph = clone.mock.calls[0][0] as { calls: Map<number, unknown>; outcomeChecks: Map<number, unknown> };
  expect(graph.calls.size).toBe(0);
  expect(graph.outcomeChecks.size).toBe(0);
  clone.mockRestore();
});

it("checkpoint replay restores pending paused outcomes and subsequent attempt ids", () => {
  let trace: unknown[] = [];
  const e = createEngine({
    seed: 7,
    scale: 10,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      trace.push({
        time: s.time,
        attempts: [...s.attempts].map((a) => ({ id: a.id, node: a.node, outcome: a.outcome, committed: a.committed })),
      });
    },
  });
  e.load(waitingFixture());
  e.inject("source", 1);
  e.step(50);
  e.setNodeStatus("caller", "paused");
  e.step(300);
  const checkpoint = e.checkpoint();
  const replay = () => {
    trace = [];
    e.setNodeStatus("caller", "up");
    e.step(3000);
    e.inject("source", 1);
    e.step(3000);
    return { trace, snapshot: e.snapshot() };
  };
  const expected = replay();
  e.restore(checkpoint);
  expect(replay()).toEqual(expected);
});
