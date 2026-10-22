import { afterEach, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import { createEngine } from "./engine";
import { SampledLedger, type Reservation } from "./ledger";
import {
  assertLedgerInvariants,
  assertResourceInvariants,
  type LedgerInvariantState,
  type ResourceState,
} from "./resourceInvariants";

afterEach(() => vi.restoreAllMocks());

/** Two caller slots and a two-slot, 24 ms CPU callee behind an optional connection pool. */
function fixture(pool?: number) {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 2, replicas: 1, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    concurrency: 2,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 24, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.edges[1].props = {
    travelMs: 10,
    networkDelayMs: 10,
    caller: { poolConnections: pool, wait: "blocking", replyMs: 0 },
  };
  return d;
}

function run(pool?: number, verifyResources?: (state: ResourceState) => void) {
  const e = createEngine({
    seed: 7,
    scale: 10,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyResources: verifyResources ?? assertResourceInvariants,
  });
  e.load(fixture(pool));
  e.inject("source", 4);
  e.step(2_000);
}

/** The pool's exact stretched turnover, recomputed from its retired fields (pools have no lag). */
const poolTurnover = (pool: Reservation) =>
  pool.retiredActive! +
  pool.heldMs * (pool.represented / pool.weight - 1) -
  ((pool.segmentActive ?? pool.startActive) - pool.startActive);

it("a blocking caller never re-admits before its narrower pool's exact turnover", () => {
  const retire = vi.spyOn(SampledLedger.prototype, "retire");
  run(1);
  // A blocking reply retires its pool lease, then settles and retires the caller thread.
  const pairs: [Reservation, Reservation][] = [];
  let pool: Reservation | undefined;
  for (const [reservation] of retire.mock.calls) {
    if (reservation.owner !== "caller") continue;
    if (reservation.scope === "pool") pool = reservation;
    else if (reservation.scope === "thread" && pool) {
      pairs.push([pool, reservation]);
      pool = undefined;
    }
  }
  expect(pairs.length).toBeGreaterThan(1);
  for (const [lease, thread] of pairs) {
    expect(lease.weight).toBeLessThan(thread.weight);
    // Admissible end, not releaseAt: the thread's own lag is not stacked on the pool's turnover.
    expect(thread.releaseAt! + (thread.admissionLagMs ?? 0)).toBeGreaterThanOrEqual(poolTurnover(lease));
  }
});

it("a finite pool bounds the callee's first wave by the granted width", () => {
  const reserve = vi.spyOn(SampledLedger.prototype, "reserve");
  run(1);
  const callees = reserve.mock.results.flatMap((r) => {
    const lease = r.value as Reservation | undefined;
    return lease?.scope === "thread" && lease.owner === "partner" ? [lease] : [];
  });
  expect(callees.length).toBeGreaterThan(0);
  for (const lease of callees) expect(lease.weight).toBeLessThanOrEqual(1);
});

it("unbounded pools take no width-capped lease", () => {
  const reserve = vi.spyOn(SampledLedger.prototype, "reserve");
  run();
  const pools = reserve.mock.results.flatMap((r) => {
    const lease = r.value as Reservation | undefined;
    return lease?.scope === "pool" ? [lease] : [];
  });
  expect(pools.length).toBeGreaterThan(0);
  for (const lease of pools) {
    expect(lease.cap).toBe(Infinity);
    expect(lease.weight).toBe(10);
  }
});

it("the ledger oracle rejects a branch wider than its caller's cohort or held thread", () => {
  const state = (width: number, callerWidth?: number): LedgerInvariantState => {
    const ledger = new SampledLedger();
    const thread = ledger.reserve({ owner: "caller", scope: "thread", phase: "wait", startActive: 0 }, 10, 2)!;
    thread.requestWeight = 2;
    return {
      time: 0,
      ledger: ledger.state,
      nodes: [{ id: "caller", activeMs: 0, threadWeight: { work: 0, wait: 2 } }],
      edges: [
        {
          id: "call",
          poolUsed: 0,
          poolLeases: new Map(),
          poolPending: [
            { message: { width }, call: { held: true, work: { thread: thread.id, message: { width: callerWidth } } } },
          ],
        },
      ],
      inSystem: 0,
      admissionInFlight: new Map(),
      partBudget: { used: 0, blocked: false },
      logical: [],
    };
  };
  expect(() => assertLedgerInvariants(state(2))).not.toThrow();
  expect(() => assertLedgerInvariants(state(2, 1))).toThrow("branch widens its cohort");
  expect(() => assertLedgerInvariants(state(3))).toThrow("branch is wider than its caller thread");
});

it("the resource oracle rejects a running thread wider than its cohort width", () => {
  let narrowed = false;
  run(1, (state) => {
    assertResourceInvariants(state);
    const partner = [...state.nodes].find((node) => node.id === "partner");
    const work = partner?.working.find((w) => w.thread !== undefined && w.message?.width !== undefined);
    if (narrowed || !work) return;
    narrowed = true;
    work.message!.width = 0.5;
    expect(() => assertResourceInvariants(state)).toThrow("thread is wider than its cohort");
    work.message!.width = 1;
  });
  expect(narrowed).toBe(true);
});
