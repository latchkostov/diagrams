import { configureAdmission, emptyAdmission, type AdmissionPolicy } from "./admission";
import { normalizeCall, slotsKey } from "./admissionPolicy";
import type { PlanningModel } from "../model/types";

/** Common workload multiplier: account and endpoint constraints apply to the same offered workload.
 * Steady-state estimate excludes bursts, cold starts, retries and caller waits. */
export function admissionCapacities(
  entries: {
    id: string;
    policy: AdmissionPolicy;
    offered: number;
    latencyMs: number;
    endpoints: { id?: string; rate: number }[];
  }[],
  planning?: PlanningModel,
): Map<string, number> {
  const sharedState = emptyAdmission();
  configureAdmission(
    sharedState,
    entries.map((entry) => entry.policy),
    planning,
  );
  const budgets = new Map<string, { capacity: number; demand: number; members: Set<string> }>();
  const add = (key: string, capacity: number, demand: number, id: string) => {
    const budget = budgets.get(key) ?? { capacity, demand: 0, members: new Set() };
    budget.capacity = Math.min(budget.capacity, capacity);
    budget.demand += demand;
    budget.members.add(id);
    budgets.set(key, budget);
  };
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
  return result;
}
