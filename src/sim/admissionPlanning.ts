import { configureAdmission, emptyAdmission, type AdmissionPolicy } from "./admission";
import {
  normalizeCall,
  slotsKey,
  transactionRequirements,
  type CompiledCall,
  type Requirement,
} from "./admissionPolicy";
import type { PlanningModel } from "../model/types";
import { overrideWork, type ResolvedTiming } from "./timing";

type ManagedEntry = {
  id: string;
  policy: AdmissionPolicy;
  offered: number;
  timing: ResolvedTiming;
  /**
   * Workload rows: requests per second by endpoint (undefined: no endpoint) and, at a managed table router, by the
   * matched route action, whose quota buckets join the call's in one transaction (`rule`).
   */
  endpoints: { id?: string; rate: number; action?: string; route?: string; rule?: readonly Requirement[] }[];
};

/** A router's forwarded requests for one route-table action and the quota buckets they charge (request routing). */
export interface RoutedDemand {
  router: string;
  action: string;
  route: string;
  requirements: readonly Requirement[];
  rate: number;
}

type Transaction =
  { rejected: true } | { rejected: false; requirements: readonly Requirement[]; rule: readonly Requirement[] };
const readoutKey = (router: string, action: string, route: string) => JSON.stringify([router, action, route]);

/** Common workload multiplier: account and endpoint constraints apply to the same offered workload.
 * Steady-state estimate excludes bursts, cold starts and retries. */
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
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const result = new Map(entries.map((entry) => [entry.id, Infinity]));
  // Only the planner can say a transaction registered its budgets. Rejected calls remain in the ledger as
  // explicit zero-capacity results, including when another endpoint successfully uses the same rule.
  const transactions = new Map<string, Transaction>();
  const readouts = new Map<string, { key: string; rate: number }[]>();
  for (const entry of entries) {
    if (entry.policy.invalid) result.set(entry.id, 0);
    // Index declarations once and aggregate repeated targets before interpreting their requirements.
    const endpoints = new Map(entry.policy.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const calls = new Map<string | undefined, CompiledCall>();
    // Rows by endpoint and matched action: each is one kind of admission transaction.
    const rows = new Map<
      string,
      { id?: string; action?: string; rate: number; rule: readonly Requirement[]; routes: Map<string, number> }
    >();
    for (const call of entry.endpoints) {
      if (!(call.rate > 0)) continue;
      const rowKey = JSON.stringify([call.id ?? null, call.action ?? null]);
      const row = rows.get(rowKey);
      const routes = row?.routes ?? new Map<string, number>();
      routes.set(call.route ?? "", (routes.get(call.route ?? "") ?? 0) + call.rate);
      if (row) row.rate += call.rate;
      else rows.set(rowKey, { id: call.id, action: call.action, rate: call.rate, rule: call.rule ?? [], routes });
    }
    let seconds = 0;
    for (const [rowKey, { id, action, rate, rule, routes }] of rows) {
      const endpoint = id === undefined ? undefined : endpoints.get(id);
      let call = calls.get(id);
      if (!call) {
        call = normalizeCall(sharedState, entry.id, entry.policy, endpoint);
        calls.set(id, call);
      }
      const transaction: Transaction =
        (id !== undefined && !endpoint) || call.rejected
          ? { rejected: true }
          : { rejected: false, requirements: transactionRequirements(call.requirements, rule), rule };
      const transactionKey = JSON.stringify([entry.id, rowKey]);
      transactions.set(transactionKey, transaction);
      if (action !== undefined)
        for (const [route, routeRate] of routes) {
          const key = readoutKey(entry.id, action, route);
          const references = readouts.get(key) ?? [];
          references.push({ key: transactionKey, rate: routeRate });
          readouts.set(key, references);
        }
      if (transaction.rejected) {
        result.set(entry.id, 0);
        continue;
      }
      const latency = overrideWork(entry.timing, call.latencyMs).holdMs;
      seconds += (rate * latency) / 1000;
      for (const { key, quota, cost } of transaction.requirements) {
        if (cost > (quota.burst ?? quota.amount)) result.set(entry.id, 0);
        add(key, (quota.amount * 1000) / quota.windowMs, rate * cost, entry.id);
      }
      for (const [key, limit] of call.limits) {
        if (limit === 0) result.set(entry.id, 0);
        add(key, limit, (rate * latency) / 1000, entry.id);
      }
    }
    const slots = Math.min(entry.policy.slots ?? Infinity, entry.policy.api.maxInFlight ?? Infinity);
    if (slots === 0 && rows.size) result.set(entry.id, 0);
    if (slots < Infinity) add(slotsKey(entry.id), slots, seconds, entry.id);
  }
  // Unmanaged routers' rule quotas: one charge per forwarded request.
  for (const { router, action, route, requirements, rate } of routed) {
    if (byId.has(router)) continue;
    const transaction: Transaction = { rejected: false, requirements, rule: requirements };
    transactions.set(readoutKey(router, action, route), transaction);
    readouts.set(readoutKey(router, action, route), [{ key: readoutKey(router, action, route), rate }]);
    for (const { key, quota, cost } of transaction.requirements)
      add(key, cost > (quota.burst ?? quota.amount) ? 0 : (quota.amount * 1000) / quota.windowMs, rate * cost);
  }
  for (const budget of budgets.values())
    if (budget.demand > 0)
      for (const id of budget.members) {
        const entry = byId.get(id);
        if (entry) result.set(id, Math.min(result.get(id) ?? 0, (entry.offered * budget.capacity) / budget.demand));
      }
  const admitted = routed.map(({ router, action, route, rate }) => {
    if (!(rate > 0)) return 1;
    const references = readouts.get(readoutKey(router, action, route)) ?? [];
    return (
      references.reduce((sum, { key, rate: offered }) => {
        const transaction = transactions.get(key);
        if (!transaction || transaction.rejected) return sum;
        const fraction = transaction.rule.reduce((fraction, { key, quota, cost }) => {
          const budget = budgets.get(key);
          if (!budget || cost > (quota.burst ?? quota.amount)) return 0;
          return Math.min(fraction, budget.demand > 0 ? Math.min(1, budget.capacity / budget.demand) : 1);
        }, 1);
        return sum + offered * fraction;
      }, 0) / rate
    );
  });
  return { capacities: result, admitted };
}
