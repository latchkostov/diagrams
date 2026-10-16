import { configureAdmission, emptyAdmission, type AdmissionPolicy } from "./admission";
import { normalizeCall, slotsKey, type Requirement } from "./admissionPolicy";
import type { PlanningModel } from "../model/types";

type ManagedEntry = {
  id: string;
  policy: AdmissionPolicy;
  offered: number;
  latencyMs: number;
  endpoints: { id?: string; rate: number }[];
};

/** A router's forwarded requests for one route-table action and the quota buckets they charge (request routing). */
export interface RoutedDemand {
  requirements: readonly Requirement[];
  rate: number;
}

/** Common workload multiplier: account and endpoint constraints apply to the same offered workload.
 * Steady-state estimate excludes bursts, cold starts, retries and caller waits. */
export function admissionCapacities(entries: ManagedEntry[], planning?: PlanningModel): Map<string, number> {
  return admissionPlan(entries, planning).capacities;
}

/**
 * One steady-state ledger for every bucket: managed nodes' and endpoints' quotas and limits, and route-table rule
 * quotas (`routed`), so a shared quota named by both is one budget, as in playback. Returns each managed node's
 * capacity and the fraction of each routed demand its buckets admit (a bucket that can't hold one request admits
 * nothing).
 */
export function admissionPlan(
  entries: ManagedEntry[],
  planning?: PlanningModel,
  routed: readonly RoutedDemand[] = [],
): { capacities: Map<string, number>; admitted: number[] } {
  const sharedState = emptyAdmission();
  configureAdmission(
    sharedState,
    entries.map((entry) => entry.policy),
    planning,
  );
  const budgets = new Map<string, { capacity: number; demand: number; members: Set<string> }>();
  const add = (key: string, capacity: number, demand: number, id?: string) => {
    const budget = budgets.get(key) ?? { capacity, demand: 0, members: new Set() };
    budget.capacity = Math.min(budget.capacity, capacity);
    budget.demand += demand;
    if (id !== undefined) budget.members.add(id);
    budgets.set(key, budget);
  };
  for (const { requirements, rate } of routed)
    for (const { key, quota, cost } of requirements)
      add(key, cost > (quota.burst ?? quota.amount) ? 0 : (quota.amount * 1000) / quota.windowMs, rate * cost);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const result = new Map(entries.map((entry) => [entry.id, Infinity]));
  for (const entry of entries) {
    if (entry.policy.invalid) {
      result.set(entry.id, 0);
      continue;
    }
    // Index declarations once and aggregate repeated targets before interpreting their requirements.
    const endpoints = new Map(entry.policy.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const rates = new Map<string | undefined, number>();
    for (const call of entry.endpoints) if (call.rate > 0) rates.set(call.id, (rates.get(call.id) ?? 0) + call.rate);
    let seconds = 0;
    for (const [id, rate] of rates) {
      const endpoint = id === undefined ? undefined : endpoints.get(id);
      const call = normalizeCall(sharedState, entry.id, entry.policy, endpoint);
      if ((id !== undefined && !endpoint) || call.rejected) {
        result.set(entry.id, 0);
        continue;
      }
      const latency = call.latencyMs ?? entry.latencyMs;
      seconds += (rate * latency) / 1000;
      for (const { key, quota, cost } of call.requirements) {
        if (cost > (quota.burst ?? quota.amount)) result.set(entry.id, 0);
        add(key, (quota.amount * 1000) / quota.windowMs, rate * cost, entry.id);
      }
      for (const [key, limit] of call.limits) {
        if (limit === 0) result.set(entry.id, 0);
        add(key, limit, (rate * latency) / 1000, entry.id);
      }
    }
    const slots = Math.min(entry.policy.slots ?? Infinity, entry.policy.api.maxInFlight ?? Infinity);
    if (slots === 0 && rates.size) result.set(entry.id, 0);
    if (slots < Infinity) add(slotsKey(entry.id), slots, seconds, entry.id);
  }
  for (const budget of budgets.values())
    if (budget.demand > 0)
      for (const id of budget.members) {
        const entry = byId.get(id)!;
        result.set(id, Math.min(result.get(id)!, (entry.offered * budget.capacity) / budget.demand));
      }
  const admitted = routed.map(({ requirements, rate }) =>
    rate > 0
      ? requirements.reduce((fraction, { key }) => {
          const budget = budgets.get(key)!;
          return Math.min(fraction, budget.demand > 0 ? Math.min(1, budget.capacity / budget.demand) : 1);
        }, 1)
      : 1,
  );
  return { capacities: result, admitted };
}
