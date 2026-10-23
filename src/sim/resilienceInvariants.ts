import type { RetryPolicy } from "../model/admission";
import type { LogicalBranch } from "./attempt";
import type { EdgeSimState } from "./types";

export interface ResilienceState {
  breakerDispatches: readonly { state: string; sent: number; probes: number; units: number }[];
  time: number;
  inSystem: number;
  edges: Iterable<{
    id: string;
    retry?: { policy: RetryPolicy };
    breaker?: { state: { inFlight: number } };
    calls: NonNullable<EdgeSimState["calls"]>;
  }>;
  calls: Iterable<{ branches: ReadonlyMap<string, LogicalBranch> }>;
  logical: readonly { id: number; retry?: boolean }[];
  budgetDecisions: readonly {
    requests: number;
    retried: number;
    units: number;
    budget: NonNullable<RetryPolicy["budget"]>;
  }[];
}

/** Independent, opt-in oracle. R2 checks every admitted retry at its decision
 * time: expiring request buckets cannot retrospectively revoke an allowance. */
export function assertResilienceInvariants(state: ResilienceState): void {
  const check = (ok: boolean, rule: string) => {
    if (!ok) throw new Error(`${rule} @${state.time}`);
  };
  const edges = new Map([...state.edges].map((e) => [e.id, e]));
  const events = new Set(state.logical.filter((e) => e.retry).map((e) => e.id));
  let backingOff = 0;
  for (const call of state.calls)
    for (const [id, branch] of call.branches) {
      const policy = edges.get(id)?.retry?.policy;
      if (!policy) continue;
      check(branch.attempt! >= 1 && branch.attempt! <= Math.min(10, policy.maxAttempts), "R1 attempts");
      if (branch.state === "backoff") {
        backingOff++;
        check(branch.retryEvent !== undefined && events.delete(branch.retryEvent), "R6 missing retry event");
      } else check(branch.retryEvent === undefined, "R6 stale retry event");
    }
  check(events.size === 0, "R6 orphan retry event");
  for (const gate of state.breakerDispatches) {
    check(gate.state !== "open", "R3 dispatch while open");
    if (gate.state === "half-open") {
      check(gate.probes - (gate.sent - gate.units) + 1e-9 >= Math.min(1, gate.units), "R3 probe gate");
      // A half-open breaker narrows a larger cohort to its remaining test calls: a batch never exceeds them.
      check(gate.sent <= gate.probes + 1e-9, "R3 probe batch");
    }
  }
  for (const gate of state.budgetDecisions) {
    const allowance = Math.max((gate.budget.minPerSec ?? 10) * 10, (gate.budget.percent / 100) * gate.requests);
    check(gate.retried + gate.units <= allowance + 1e-8, "R2 retry budget");
  }
  for (const edge of edges.values())
    if (edge.retry) {
      const c = edge.calls;
      check(Math.abs(c.requests! + c.retried! - c.attempts! - c.shortCircuited!) < 1e-7, "R5 conservation");
      check(c.backingOff! >= -1e-8, "R6 negative backoff");
      if (!state.inSystem) {
        check(c.backingOff === 0 && c.held === 0, "R6 idle holds");
        check(!edge.breaker?.state.inFlight, "R6 idle probes");
      }
    }
  if (!state.inSystem) check(backingOff === 0, "R6 idle retry events");
}
