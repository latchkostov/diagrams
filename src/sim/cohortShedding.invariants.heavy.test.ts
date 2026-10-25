import fc from "fast-check";
import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { propertyRuns } from "../test/fastCheck";
import type { DiagramFile } from "../model/types";
import type { EdgeSimProps, NodeSimProps, QueuePolicy, SimSnapshot } from "./types";
import { createEngine } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, type LedgerInvariantState } from "./resourceInvariants";
import { realSnapshot } from "./units";

// The shedding quarantine (docs/backlog/2026-10-25-cohort-shedding-timeouts.md): no pool cohort opens while
// any queue policy exists, and a queue enabled while cohorts are open never sheds their members.
// Callers have one pooled, deadline-bound call and the callee never fails, so every real request on the
// edge ends exactly one way: an OK reply before its deadline, a shed (a failure), or a timeout.

const queuePolicy = fc.record(
  {
    limit: fc.integer({ min: 1, max: 4 }),
    whenFull: fc.constantFrom("reject-new" as const, "drop-oldest" as const),
    maxWaitMs: fc.integer({ min: 20, max: 400 }),
  },
  { requiredKeys: ["limit"] },
) as fc.Arbitrary<QueuePolicy>;

const action = fc.oneof(
  fc.record({ kind: fc.constant("inject" as const), dots: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant("queue" as const), policy: fc.option(queuePolicy, { nil: undefined }) }),
  fc.record({ kind: fc.constant("pause" as const), paused: fc.boolean() }),
);

const scenario = fc.record({
  scale: fc.constantFrom(1, 10),
  pool: fc.integer({ min: 1, max: 10 }),
  deadlineMs: fc.integer({ min: 30, max: 1200 }),
  blocking: fc.boolean(),
  callerConcurrency: fc.constantFrom(2, 100),
  calleeConcurrency: fc.integer({ min: 1, max: 3 }),
  latencyMs: fc.integer({ min: 0, max: 200 }),
  travelMs: fc.integer({ min: 0, max: 200 }),
  queue: fc.option(queuePolicy, { nil: undefined }),
  paused: fc.boolean(),
  steps: fc.array(fc.record({ waitMs: fc.integer({ min: 10, max: 400 }), action }), { minLength: 1, maxLength: 8 }),
});
type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

function diagram(s: Scenario): DiagramFile {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[1].props = { concurrency: s.callerConcurrency, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    concurrency: s.calleeConcurrency,
    latencyMs: s.latencyMs,
    jitter: 0,
    ...(s.paused ? { status: "paused" } : {}),
    ...(s.queue ? { queue: s.queue } : {}),
  } as NodeSimProps;
  d.edges[1].props = {
    travelMs: s.travelMs,
    caller: { wait: s.blocking ? "blocking" : "non-blocking", poolConnections: s.pool, deadlineMs: s.deadlineMs },
  } as EdgeSimProps;
  return d;
}

function run(s: Scenario, options: { noCohorts?: boolean } = {}) {
  const cohorts = new Set<number>();
  let queued = !!s.queue;
  let opened = 0;
  const e = createEngine({
    scale: s.scale,
    seed: 7,
    maxParticles: 0,
    ...options,
    verifyLedger(state: LedgerInvariantState) {
      assertLedgerInvariants(state);
      for (const edge of state.edges)
        for (const id of edge.cohorts?.keys() ?? []) {
          if (cohorts.has(id)) continue;
          cohorts.add(id);
          // No cohort opens while a queue policy exists (edits only happen between steps).
          expect(queued, `cohort ${id} opened while a queue policy existed`).toBe(false);
          opened++;
        }
    },
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(diagram(s));
  let members = 0;
  for (const { waitMs, action } of s.steps) {
    e.step(waitMs);
    if (action.kind === "inject") {
      e.inject("source", action.dots);
      members += action.dots * s.scale;
    } else if (action.kind === "queue") {
      queued = action.policy !== undefined;
      e.setNodeProps("partner", { queue: action.policy });
    } else e.setNodeStatus("partner", action.paused ? "paused" : "up");
  }
  e.setNodeStatus("partner", "up");
  // Drain: queued waves on a one-slot callee can take many seconds.
  for (let t = 0; t < 120_000 && e.snapshot().inSystem; t += 1000) e.step(1000);
  return { snapshot: e.snapshot(), members, opened };
}

function counts(snapshot: SimSnapshot) {
  const real = realSnapshot(snapshot);
  const calls = real.edges.call.calls!;
  return {
    timedOut: calls.timedOut,
    failed: calls.failed,
    late: calls.late,
    delivered: real.edges.call.delivered,
    shed: real.nodes.partner.shed ?? 0,
  };
}

it("pooled deadline cohorts never meet shedding: conservation, no lost or double-counted members", () => {
  fc.assert(
    fc.property(scenario, (s) => {
      const { snapshot, members } = run(s);
      expect(snapshot.inSystem).toBe(0);
      const c = counts(snapshot);
      const at = JSON.stringify({ members, ...c });
      const tolerance = 1e-6;
      // Each member ends exactly one way: unsent and expired (a timeout), shed before its deadline (a failure),
      // shed after it (already a timeout), replied OK in time, or processed after its deadline (a timeout and
      // a late reply). Solving for the shed and late groups from the edge counters:
      const shedInTime = c.failed - c.timedOut;
      const shedLate = c.shed - shedInTime;
      const processedLate = c.timedOut - (members - c.delivered) - shedLate;
      // Each member is sent at most once, and fails at most once.
      expect(c.delivered, at).toBeLessThanOrEqual(members + tolerance);
      expect(c.failed, at).toBeLessThanOrEqual(members + tolerance);
      // A failure is a timeout or an in-time shed, never both.
      expect(shedInTime, at).toBeGreaterThanOrEqual(-tolerance);
      expect(shedLate, at).toBeGreaterThanOrEqual(-tolerance);
      // No unsent member is lost: every one of them timed out.
      expect(processedLate, at).toBeGreaterThanOrEqual(-tolerance);
      // No member times out twice: each late-processed member replies late once; a late shed may reply too.
      expect(processedLate, at).toBeLessThanOrEqual(c.late + tolerance);
      expect(c.late, at).toBeLessThanOrEqual(processedLate + shedLate + tolerance);
    }),
    { numRuns: propertyRuns(40) },
  );
});

it("a run with a queue policy throughout is exactly the pre-cohort call path", () => {
  const throughout = (s: Scenario) =>
    s.queue !== undefined && s.steps.every(({ action }) => action.kind !== "queue" || action.policy !== undefined);
  fc.assert(
    fc.property(scenario.filter(throughout), (s) => {
      const legacy = run(s, { noCohorts: true });
      const quarantined = run(s);
      expect(quarantined.opened).toBe(0);
      expect(quarantined.snapshot).toEqual(legacy.snapshot);
    }),
    { numRuns: propertyRuns(20) },
  );
});
