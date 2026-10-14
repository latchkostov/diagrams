import type { ApiBehaviour, ApiEndpoint, Quota, QuotaUnit } from "../model/admission";
import type { PlanningModel } from "../model/types";

export interface AdmissionPolicy {
  invalid?: boolean;
  api: ApiBehaviour;
  endpoints: ApiEndpoint[];
  slots?: number;
  accountConcurrency?: number;
  fixedSlotsPerReplica?: number;
}
interface Bucket {
  tokens: number;
  time: number;
  signature: string;
  capacity: number;
  rate: number;
}
export interface AdmissionState {
  buckets: Map<string, Bucket>;
  inFlight: Map<string, number>;
  conflicts: Set<string>;
}
export const emptyAdmission = (): AdmissionState => ({ buckets: new Map(), inFlight: new Map(), conflicts: new Set() });
export interface AdmissionLease {
  keys: string[];
  weight: number;
}
const signature = (q: Quota) => JSON.stringify([q.unit, q.amount, q.windowMs, q.burst ?? q.amount, q.algorithm]);

/** Validate shared definitions as a whole, before the first caller can consume anything. */
export function configureAdmission(state: AdmissionState, policies: AdmissionPolicy[], planning?: PlanningModel) {
  state.conflicts.clear();
  const quotas = new Map<string, string>();
  const allocations = new Map<string, number>();
  const quota = (id: string, q: Quota) => {
    if (quotas.has(id) && quotas.get(id) !== signature(q)) state.conflicts.add(`quota:${id}`);
    quotas.set(id, signature(q));
  };
  const allocation = (id: string, value: number) => {
    if (allocations.has(id) && allocations.get(id) !== value) state.conflicts.add(`concurrency:${id}`);
    allocations.set(id, value);
  };
  for (const q of planning?.sharedQuotas ?? []) quota(q.id, q);
  for (const a of planning?.sharedAllocations ?? []) allocation(a.id, a.maxInFlight);
  for (const p of policies)
    for (const api of [p.api, ...p.endpoints.map((e) => e.behaviour)]) {
      for (const q of api?.quotas ?? []) if (q.sharedGroup) quota(q.sharedGroup, q);
      // An explicit allocation is authoritative. Nodes can have smaller local caps.
      if (
        api?.sharedConcurrency &&
        api.maxInFlight !== undefined &&
        !planning?.sharedAllocations?.some((a) => a.id === api.sharedConcurrency)
      )
        allocation(api.sharedConcurrency, api === p.api ? (p.accountConcurrency ?? api.maxInFlight) : api.maxInFlight);
    }
}

/** All applicable budgets are checked before any are charged. Time is exclusively simulation time. */
export function attemptAdmission(
  state: AdmissionState,
  node: string,
  policy: AdmissionPolicy,
  endpointId: string | undefined,
  planning: PlanningModel | undefined,
  now: number,
  weight: number,
): { lease: AdmissionLease; latencyMs?: number; errorRate?: number } | { rejected: string } {
  if (policy.invalid) return { rejected: "invalid admission data" };
  const endpoint = endpointId ? policy.endpoints.find((e) => e.id === endpointId) : undefined;
  if (endpointId && !endpoint) return { rejected: "unknown endpoint" };
  const behaviour = endpoint?.behaviour;
  const costs = { ...policy.api.costPerRequest, ...behaviour?.costPerRequest };
  const requirements = new Map<string, { quota: Quota; cost: number }>();
  for (const [scope, quotas] of [
    ["node", policy.api.quotas],
    [endpointId, behaviour?.quotas],
  ] as const) {
    for (const declared of quotas ?? []) {
      if (declared.sharedGroup && state.conflicts.has(`quota:${declared.sharedGroup}`))
        return { rejected: "conflicting shared quota" };
      const authority = declared.sharedGroup
        ? planning?.sharedQuotas?.find((q) => q.id === declared.sharedGroup)
        : undefined;
      if (authority && signature(authority) !== signature(declared)) return { rejected: "conflicting shared quota" };
      const quota = authority ?? declared;
      const key = JSON.stringify(declared.sharedGroup ? ["shared", declared.sharedGroup] : [node, scope, quota.id]);
      const cost = weight * (costs[quota.unit] ?? (quota.unit === "requests" ? 1 : 0));
      // A token/cost quota without a workload size cannot truthfully admit the request.
      if (quota.unit !== "requests" && costs[quota.unit] === undefined)
        return { rejected: `unknown ${quota.unit} cost` };
      const existing = requirements.get(key);
      if (existing && signature(existing.quota) !== signature(quota)) return { rejected: "conflicting shared quota" };
      requirements.set(key, { quota, cost }); // Same shared bucket charged once per attempt.
    }
  }
  // Report token/cost exhaustion before request rate when both bind.
  const priority = (unit: QuotaUnit) => (unit === "requests" ? 1 : 0);
  const charges: { bucket: Bucket; cost: number }[] = [];
  for (const [key, { quota, cost }] of [...requirements].sort(
    (a, b) => priority(a[1].quota.unit) - priority(b[1].quota.unit),
  )) {
    let bucket = state.buckets.get(key);
    const config = signature(quota);
    if (bucket) {
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.max(0, now - bucket.time) * bucket.rate);
      bucket.time = now;
    }
    if (bucket && bucket.signature !== config) {
      // An intentional live edit retains spent credit rather than granting a fresh burst.
      bucket.tokens = Math.min(bucket.tokens, quota.burst ?? quota.amount);
      bucket.time = now;
      bucket.signature = config;
      bucket.capacity = quota.burst ?? quota.amount;
      bucket.rate = quota.amount / quota.windowMs;
    }
    if (!bucket) {
      bucket = {
        tokens: quota.burst ?? quota.amount,
        time: now,
        signature: config,
        capacity: quota.burst ?? quota.amount,
        rate: quota.amount / quota.windowMs,
      };
      state.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      quota.burst ?? quota.amount,
      bucket.tokens + (Math.max(0, now - bucket.time) * quota.amount) / quota.windowMs,
    );
    bucket.time = now;
    if (bucket.tokens + 1e-9 < cost) return { rejected: `${quota.id}: ${quota.unit}` };
    charges.push({ bucket, cost });
  }
  const limits = new Map<string, number>();
  if (policy.slots !== undefined) limits.set(JSON.stringify([node, "slots"]), policy.slots);
  const addConcurrent = (api: ApiBehaviour | undefined, scope: string) => {
    if (!api) return;
    if (api.maxInFlight !== undefined) limits.set(JSON.stringify([node, scope]), api.maxInFlight);
    if (api.sharedConcurrency) {
      if (state.conflicts.has(`concurrency:${api.sharedConcurrency}`)) return false;
      const allocation =
        planning?.sharedAllocations?.find((a) => a.id === api.sharedConcurrency)?.maxInFlight ??
        (api === policy.api ? policy.accountConcurrency : undefined) ??
        api.maxInFlight;
      if (allocation === undefined) return false;
      limits.set(JSON.stringify(["shared", api.sharedConcurrency]), allocation);
    }
    return true;
  };
  if (addConcurrent(policy.api, "node") === false || addConcurrent(behaviour, endpointId ?? "endpoint") === false)
    return { rejected: "unknown shared allocation" };
  for (const [key, limit] of limits)
    if ((state.inFlight.get(key) ?? 0) + weight > limit + 1e-9) return { rejected: "concurrency" };
  for (const { bucket, cost } of charges) bucket.tokens -= cost;
  for (const key of limits.keys()) state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + weight);
  return {
    lease: { keys: [...limits.keys()], weight },
    latencyMs: behaviour?.latencyMs ?? policy.api.latencyMs,
    errorRate: behaviour?.errorRate ?? policy.api.errorRate,
  };
}
export function releaseAdmission(state: AdmissionState, lease?: AdmissionLease) {
  if (lease)
    for (const key of lease.keys) state.inFlight.set(key, Math.max(0, (state.inFlight.get(key) ?? 0) - lease.weight));
}
