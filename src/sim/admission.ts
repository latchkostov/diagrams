import type { ApiBehaviour, ApiEndpoint, Quota } from "../model/admission";
import type { PlanningModel } from "../model/types";
import { concurrencyKey, quotaKey, quotaSignature, sharedConcurrencyKey, slotsKey } from "./admissionPolicy";

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
  capacity: number;
  rate: number;
}
interface Requirement {
  key: string;
  quota: Quota;
  cost: number;
}
interface CompiledCall {
  rejected?: string;
  requirements: Requirement[];
  limits: Map<string, number>;
  latencyMs?: number;
  errorRate?: number;
}
interface CompiledNode {
  calls: Map<string | undefined, CompiledCall>;
  slots: string;
}
export interface AdmissionState {
  buckets: Map<string, Bucket>;
  inFlight: Map<string, number>;
  conflicts: Set<string>;
  allocations: Map<string, number>;
  sharedQuotas: Map<string, Quota>;
  explicitAllocations: Map<string, number>;
  definitions: Map<string, Map<AdmissionPolicy, Set<string | number>>>;
  policies: Map<string, AdmissionPolicy>;
  compiled: Map<AdmissionPolicy, Map<string, CompiledNode>>;
  owners: Map<AdmissionPolicy, string>;
}
export const emptyAdmission = (): AdmissionState => ({
  buckets: new Map(),
  inFlight: new Map(),
  conflicts: new Set(),
  allocations: new Map(),
  sharedQuotas: new Map(),
  explicitAllocations: new Map(),
  definitions: new Map(),
  policies: new Map(),
  compiled: new Map(),
  owners: new Map(),
});
export interface AdmissionLease {
  keys: string[];
  weight: number;
}

/** Index each definition/reference once. Reference-only callers also participate in invalidation. */
function register(state: AdmissionState, policy: AdmissionPolicy, remove = false): Set<string> {
  const touched = new Set<string>();
  for (const api of [policy.api, ...policy.endpoints.map((e) => e.behaviour)]) {
    const add = (key: string, value?: string | number) => {
      touched.add(key);
      const definitions = state.definitions.get(key) ?? new Map<AdmissionPolicy, Set<string | number>>();
      if (remove) definitions.delete(policy);
      else {
        const values = definitions.get(policy) ?? new Set<string | number>();
        if (value !== undefined) values.add(value);
        definitions.set(policy, values);
      }
      state.definitions.set(key, definitions);
    };
    for (const q of api?.quotas ?? []) if (q.sharedGroup) add(`quota:${q.sharedGroup}`, quotaSignature(q));
    if (api?.sharedConcurrency)
      add(
        `concurrency:${api.sharedConcurrency}`,
        api.maxInFlight === undefined
          ? undefined
          : api === policy.api
            ? (policy.accountConcurrency ?? api.maxInFlight)
            : api.maxInFlight,
      );
  }
  return touched;
}
function resolveShared(state: AdmissionState, key: string): void {
  const definitions = state.definitions.get(key);
  const values = new Set<string | number>();
  for (const declared of definitions?.values() ?? []) for (const value of declared) values.add(value);
  state.conflicts.delete(key);
  if (key.startsWith("quota:")) {
    const explicit = state.sharedQuotas.get(key.slice(6));
    if (explicit) values.add(quotaSignature(explicit));
  } else {
    const id = key.slice(12);
    const explicit = state.explicitAllocations.get(id);
    if (explicit !== undefined) {
      state.allocations.set(id, explicit);
      return; // Explicit account allocations permit smaller local caps.
    }
    state.allocations.delete(id);
    if (values.size === 1) state.allocations.set(id, [...values][0] as number);
  }
  if (values.size > 1) state.conflicts.add(key);
}
/** Validate shared definitions as a whole, before the first caller consumes anything. */
export function configureAdmission(state: AdmissionState, policies: AdmissionPolicy[], planning?: PlanningModel) {
  state.conflicts.clear();
  state.definitions.clear();
  state.policies.clear();
  state.owners.clear();
  state.compiled.clear();
  state.allocations.clear();
  state.sharedQuotas = new Map((planning?.sharedQuotas ?? []).map((q) => [q.id, q]));
  state.explicitAllocations = new Map((planning?.sharedAllocations ?? []).map((a) => [a.id, a.maxInFlight]));
  for (const policy of policies) register(state, policy);
  for (const key of state.definitions.keys()) resolveShared(state, key);
}
function refill(bucket: Bucket, now: number) {
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.max(0, now - bucket.time) * bucket.rate);
  bucket.time = now;
}
function compileCall(
  state: AdmissionState,
  node: string,
  policy: AdmissionPolicy,
  endpoint?: ApiEndpoint,
): CompiledCall {
  const behaviour = endpoint?.behaviour;
  const call: CompiledCall = {
    requirements: [],
    limits: new Map(),
    latencyMs: behaviour?.latencyMs ?? policy.api.latencyMs,
    errorRate: behaviour?.errorRate ?? policy.api.errorRate,
  };
  if (policy.invalid) {
    call.rejected = "invalid admission data";
    return call;
  }
  const costs = { ...policy.api.costPerRequest, ...behaviour?.costPerRequest };
  const requirements = new Map<string, Requirement>();
  for (const [api, scope] of [
    [policy.api, ["node"]],
    [behaviour, ["endpoint", endpoint?.id ?? ""]],
  ] as const) {
    for (const declared of api?.quotas ?? []) {
      if (declared.sharedGroup && state.conflicts.has(`quota:${declared.sharedGroup}`)) {
        call.rejected = "conflicting shared quota";
        return call;
      }
      const quota = (declared.sharedGroup ? state.sharedQuotas.get(declared.sharedGroup) : undefined) ?? declared;
      if (quota.unit !== "requests" && costs[quota.unit] === undefined) {
        call.rejected = `unknown ${quota.unit} cost`;
        return call;
      }
      const key = quotaKey(node, scope, declared);
      requirements.set(key, { key, quota, cost: costs[quota.unit] ?? 1 });
    }
    if (api?.maxInFlight !== undefined) call.limits.set(concurrencyKey(node, scope), api.maxInFlight);
    if (api?.sharedConcurrency) {
      const allocation = state.allocations.get(api.sharedConcurrency);
      if (state.conflicts.has(`concurrency:${api.sharedConcurrency}`) || allocation === undefined) {
        call.rejected = "unknown shared allocation";
        return call;
      }
      call.limits.set(sharedConcurrencyKey(api.sharedConcurrency), allocation);
    }
  }
  call.requirements = [...requirements.values()].sort(
    (a, b) => Number(a.quota.unit === "requests") - Number(b.quota.unit === "requests"),
  );
  return call;
}
function compileNode(state: AdmissionState, node: string, policy: AdmissionPolicy): CompiledNode {
  const compiled: CompiledNode = {
    slots: slotsKey(node),
    calls: new Map([[undefined, compileCall(state, node, policy)]]),
  };
  for (const endpoint of policy.endpoints) compiled.calls.set(endpoint.id, compileCall(state, node, policy, endpoint));
  const nodes = state.compiled.get(policy) ?? new Map<string, CompiledNode>();
  nodes.set(node, compiled);
  state.compiled.set(policy, nodes);
  return compiled;
}
/** Apply only changed node definitions, and invalidate callers of changed shared definitions.
 * Unchanged nodes retain their compiled endpoint requirements and bucket credit. */
export function reconfigureAdmission(
  state: AdmissionState,
  entries: { id: string; policy?: AdmissionPolicy }[],
  planning: PlanningModel | undefined,
  now: number,
) {
  // Planning changes reload the engine; this argument is retained for callers configuring a fresh state.
  if (!state.policies.size && !state.definitions.size) configureAdmission(state, [], planning);
  const touched = new Set<string>();
  const before = new Map<string, string>();
  const sharedValue = (key: string) =>
    JSON.stringify([
      state.conflicts.has(key),
      key.startsWith("concurrency:")
        ? state.allocations.get(key.slice(12))
        : [...(state.definitions.get(key)?.values() ?? [])].flatMap((v) => [...v]).sort(),
    ]);
  const remember = (policy: AdmissionPolicy) => {
    for (const api of [policy.api, ...policy.endpoints.map((e) => e.behaviour)]) {
      const keys = [
        ...(api?.quotas ?? []).flatMap((q) => (q.sharedGroup ? [`quota:${q.sharedGroup}`] : [])),
        ...(api?.sharedConcurrency ? [`concurrency:${api.sharedConcurrency}`] : []),
      ];
      for (const key of keys) if (!before.has(key)) before.set(key, sharedValue(key));
    }
  };
  const affected = new Set<AdmissionPolicy>();
  for (const { id, policy } of entries) {
    const previous = state.policies.get(id);
    if (previous) {
      remember(previous);
      for (const key of register(state, previous, true)) touched.add(key);
      state.compiled.delete(previous);
      state.owners.delete(previous);
    }
    if (policy) {
      remember(policy);
      for (const key of register(state, policy)) touched.add(key);
      state.policies.set(id, policy);
      state.owners.set(policy, id);
      affected.add(policy);
    } else state.policies.delete(id);
  }
  for (const key of touched) {
    resolveShared(state, key);
    if (before.get(key) !== sharedValue(key))
      for (const policy of state.definitions.get(key)?.keys() ?? []) {
        state.compiled.delete(policy);
        affected.add(policy);
      }
  }
  const seen = new Set<string>();
  for (const policy of affected) {
    const id = state.owners.get(policy);
    if (id === undefined) continue;
    const compiled = compileNode(state, id, policy);
    for (const call of compiled.calls.values())
      for (const { key, quota } of call.requirements) {
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = state.buckets.get(key);
        if (bucket) {
          refill(bucket, now);
          bucket.capacity = quota.burst ?? quota.amount;
          bucket.rate = quota.amount / quota.windowMs;
          bucket.tokens = Math.min(bucket.tokens, bucket.capacity);
        }
      }
  }
}
/** Only refill, check, charge and lease accounting remain in the per-attempt path. */
export function attemptAdmission(
  state: AdmissionState,
  node: string,
  policy: AdmissionPolicy,
  endpointId: string | undefined,
  _planning: PlanningModel | undefined,
  now: number,
  weight: number,
  slots = policy.slots,
): { lease: AdmissionLease; latencyMs?: number; errorRate?: number } | { rejected: string } {
  const compiled = state.compiled.get(policy)?.get(node) ?? compileNode(state, node, policy);
  const call = compiled.calls.get(endpointId);
  if (!call) return { rejected: "unknown endpoint" };
  if (call.rejected) return { rejected: call.rejected };
  for (const { key, quota, cost } of call.requirements) {
    let bucket = state.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: quota.burst ?? quota.amount,
        capacity: quota.burst ?? quota.amount,
        rate: quota.amount / quota.windowMs,
        time: now,
      };
      state.buckets.set(key, bucket);
    } else refill(bucket, now);
    if (bucket.tokens + 1e-9 < weight * cost) return { rejected: `${quota.id}: ${quota.unit}` };
  }
  if (slots !== undefined && (state.inFlight.get(compiled.slots) ?? 0) + weight > slots + 1e-9)
    return { rejected: "concurrency" };
  for (const [key, limit] of call.limits)
    if ((state.inFlight.get(key) ?? 0) + weight > limit + 1e-9) return { rejected: "concurrency" };
  for (const { key, cost } of call.requirements) state.buckets.get(key)!.tokens -= weight * cost;
  const keys = [...call.limits.keys(), ...(slots === undefined ? [] : [compiled.slots])];
  for (const key of keys) state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + weight);
  return { lease: { keys, weight }, latencyMs: call.latencyMs, errorRate: call.errorRate };
}
export function releaseAdmission(state: AdmissionState, lease?: AdmissionLease) {
  if (lease)
    for (const key of lease.keys) state.inFlight.set(key, Math.max(0, (state.inFlight.get(key) ?? 0) - lease.weight));
}
