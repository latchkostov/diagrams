import type { AdmissionPolicy } from "./admission";
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
      const endpoint = call.id ? entry.policy.endpoints.find((e) => e.id === call.id) : undefined;
      if (call.id && !endpoint) {
        result.set(entry.id, 0);
        continue;
      }
      const api = endpoint?.behaviour;
      const latency = api?.latencyMs ?? entry.policy.api.latencyMs ?? entry.latencyMs;
      seconds += (call.rate * latency) / 1000;
      const costs = { ...entry.policy.api.costPerRequest, ...api?.costPerRequest };
      const once = new Set<string>();
      const quota = (q: Quota, scope: string) => {
        const key = JSON.stringify(q.sharedGroup ? ["quota", q.sharedGroup] : [entry.id, scope, q.id]);
        if (once.has(key)) return;
        once.add(key);
        const cost = costs[q.unit] ?? (q.unit === "requests" ? 1 : undefined);
        if (cost === undefined) {
          result.set(entry.id, 0);
          return;
        }
        add(key, (q.amount * 1000) / q.windowMs, call.rate * cost, entry.id);
      };
      for (const q of entry.policy.api.quotas ?? []) quota(q, "global");
      for (const q of api?.quotas ?? []) quota(q, call.id!);
      if (api?.maxInFlight !== undefined)
        add(
          JSON.stringify([entry.id, call.id, "concurrency"]),
          api.maxInFlight,
          (call.rate * latency) / 1000,
          entry.id,
        );
      const shared = new Map<string, number>();
      for (const [behaviour, fallback] of [
        [entry.policy.api, entry.policy.accountConcurrency],
        [api, undefined],
      ] as const) {
        if (!behaviour?.sharedConcurrency) continue;
        const id = behaviour.sharedConcurrency;
        const allocation =
          planning?.sharedAllocations?.find((a) => a.id === id)?.maxInFlight ?? fallback ?? behaviour.maxInFlight ?? 0;
        shared.set(id, allocation);
      }
      for (const [id, allocation] of shared)
        add(JSON.stringify(["concurrency", id]), allocation, (call.rate * latency) / 1000, entry.id);
    }
    const slots = Math.min(entry.policy.slots ?? Infinity, entry.policy.api.maxInFlight ?? Infinity);
    if (slots < Infinity) add(JSON.stringify([entry.id, "slots"]), slots, seconds, entry.id);
  }
  for (const budget of budgets.values())
    if (budget.demand > 0)
      for (const id of budget.members) {
        const entry = byId.get(id)!;
        result.set(id, Math.min(result.get(id)!, (entry.offered * budget.capacity) / budget.demand));
      }
  return result;
}
