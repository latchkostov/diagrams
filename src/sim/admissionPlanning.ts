import { configureAdmission, emptyAdmission, type AdmissionPolicy } from "./admission";
import { quotaKey, concurrencyKey, sharedConcurrencyKey, slotsKey, type AdmissionScope } from "./admissionPolicy";
import type { Quota } from "../model/admission";
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
    let seconds = 0;
    for (const call of entry.endpoints) {
      if (!(call.rate > 0)) continue;
      const endpoint = call.id !== undefined ? entry.policy.endpoints.find((e) => e.id === call.id) : undefined;
      if (call.id !== undefined && !endpoint) {
        result.set(entry.id, 0);
        continue;
      }
      const api = endpoint?.behaviour;
      if (
        [entry.policy.api, api].some(
          (behaviour) =>
            behaviour?.quotas?.some((q) => q.sharedGroup && sharedState.conflicts.has(`quota:${q.sharedGroup}`)) ||
            (behaviour?.sharedConcurrency && sharedState.conflicts.has(`concurrency:${behaviour.sharedConcurrency}`)),
        )
      ) {
        result.set(entry.id, 0);
        continue;
      }
      const latency = api?.latencyMs ?? entry.policy.api.latencyMs ?? entry.latencyMs;
      seconds += (call.rate * latency) / 1000;
      const costs = { ...entry.policy.api.costPerRequest, ...api?.costPerRequest };
      const once = new Set<string>();
      const quota = (q: Quota, scope: AdmissionScope) => {
        const key = quotaKey(entry.id, scope, q);
        if (once.has(key)) return;
        once.add(key);
        const cost = costs[q.unit] ?? (q.unit === "requests" ? 1 : undefined);
        if (cost === undefined || cost > (q.burst ?? q.amount)) {
          result.set(entry.id, 0);
          return;
        }
        add(key, (q.amount * 1000) / q.windowMs, call.rate * cost, entry.id);
      };
      for (const q of entry.policy.api.quotas ?? []) quota(q, ["node"]);
      for (const q of api?.quotas ?? []) quota(q, ["endpoint", call.id!]);
      if (api?.maxInFlight !== undefined)
        add(concurrencyKey(entry.id, ["endpoint", call.id!]), api.maxInFlight, (call.rate * latency) / 1000, entry.id);
      const shared = new Map<string, number>();
      for (const behaviour of [entry.policy.api, api]) {
        if (!behaviour?.sharedConcurrency) continue;
        const id = behaviour.sharedConcurrency;
        const allocation = sharedState.allocations.get(id) ?? 0;
        shared.set(id, allocation);
      }
      for (const [id, allocation] of shared)
        add(sharedConcurrencyKey(id), allocation, (call.rate * latency) / 1000, entry.id);
    }
    const slots = Math.min(entry.policy.slots ?? Infinity, entry.policy.api.maxInFlight ?? Infinity);
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
