import type { ApiBehaviour, ApiEndpoint, Quota } from "../model/admission";
import type { PlanningModel } from "../model/types";
import { reserveCallerOccupancy, type CallerOccupancy } from "./ledger";
import {
  normalizeCall,
  quotaKey,
  quotaSignature,
  slotsKey,
  sharedConcurrencyKey,
  transactionRequirements,
  uniqueRequirements,
  type CompiledCall,
  type Requirement,
} from "./admissionPolicy";

export type QuotaRequirement = Requirement;

/**
 * A router action's quotas (request routing): local buckets scoped to the router and rule (key "" is Default), or
 * the planning's shared definition, which every caller charges as one bucket. Requests only: one per request.
 */
export function quotaRequirements(
  node: string,
  key: string,
  quotas: readonly Quota[],
  planning: PlanningModel | undefined,
  /** The planning's shared quotas by id, when the caller indexes them once for many actions. */
  shared: ReadonlyMap<string, Quota> = new Map((planning?.sharedQuotas ?? []).map((q) => [q.id, q])),
): QuotaRequirement[] {
  return uniqueRequirements(
    quotas.map((declared) => ({
      key: quotaKey(node, ["rule", key], declared),
      quota: (declared.sharedGroup ? shared.get(declared.sharedGroup) : undefined) ?? declared,
      cost: 1,
    })),
  );
}

/** Check every bucket, then charge them all, or none: the router's quota transaction without a P3 policy. */
export function attemptQuotas(
  state: AdmissionState,
  requirements: readonly QuotaRequirement[],
  now: number,
  weight: number,
): string | undefined {
  const seen = new Set<string>();
  for (const { key, quota, cost } of requirements) {
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = bucketAt(state, key, quota, now);
    if (bucket.tokens + 1e-9 < weight * cost) return `${quota.id}: ${quota.unit}`;
  }
  seen.clear();
  for (const { key, cost } of requirements) {
    if (seen.has(key)) continue;
    seen.add(key);
    state.buckets.get(key)!.tokens -= weight * cost;
  }
  return undefined;
}

/** Live edits keep spent credit: refill to now on the old rate, then apply the new cap and rate (no fresh burst). */
export function reconfigureQuotas(state: AdmissionState, requirements: readonly QuotaRequirement[], now: number): void {
  for (const { key, quota } of requirements) {
    const bucket = state.buckets.get(key);
    if (!bucket) continue;
    refill(bucket, now);
    bucket.capacity = quota.burst ?? quota.amount;
    bucket.rate = quota.amount / quota.windowMs;
    bucket.tokens = Math.min(bucket.tokens, bucket.capacity);
  }
}

function bucketAt(state: AdmissionState, key: string, quota: Quota, now: number): Bucket {
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
  return bucket;
}

export interface AdmissionPolicy {
  invalid?: boolean;
  /** Scalar fleet edits share the immutable compiled requirements of this policy. */
  requirementsPolicy?: AdmissionPolicy;
  api: ApiBehaviour;
  endpoints: ApiEndpoint[];
  /** Allocation ceiling; multiplied/assigned fixed fleet capacity is applied separately. */
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
/** Checkpoint replacement keeps admission state mutations within its owner. */
export function restoreAdmission(state: AdmissionState, saved: Pick<AdmissionState, "buckets" | "inFlight">): void {
  state.buckets = saved.buckets;
  state.inFlight = saved.inFlight;
}
export interface AdmissionLease extends CallerOccupancy {
  keys: string[];
}
export interface AdmissionLeases {
  request: AdmissionLease;
  thread?: AdmissionLease;
}

/** Execution slots can be returned while the admitted request still owns its concurrency limits. */
function separateAdmission(lease: AdmissionLease, slot?: string): AdmissionLeases & { thread: AdmissionLease } {
  return {
    request: { ...lease, keys: lease.keys.filter((key) => key !== slot) },
    thread: { ...lease, keys: lease.keys.filter((key) => key === slot) },
  };
}

/** Capacity-only transaction: no buckets, clocks, or attempt timing are touched. */
export function reacquire(
  state: AdmissionState,
  capacity: {
    node: string;
    policy?: AdmissionPolicy;
    endpointId?: string;
    slots: number;
    room: number;
    request?: AdmissionLease;
    thread: AdmissionLease;
  },
): { request?: AdmissionLease; thread: AdmissionLease } | null {
  const { node, policy, room, slots } = capacity;
  const compiled = policy
    ? (state.compiled.get(policy.requirementsPolicy ?? policy)?.get(node) ?? compileNode(state, node, policy))
    : undefined;
  const call = compiled?.calls.get(capacity.endpointId);
  if (policy && (!call || call.rejected)) return null;
  const request = capacity.request
    ? { ...capacity.request, keys: [...new Set([...capacity.request.keys, ...(call?.limits.keys() ?? [])])] }
    : undefined;
  const thread = {
    ...capacity.thread,
    keys: [...new Set([...capacity.thread.keys, ...(policy ? [slotsKey(node)] : [])])],
  };
  if (thread.weight > room + 1e-9 || thread.weight < Math.min(1, thread.represented)) return null;
  const limits = new Map(call?.limits);
  limits.set(slotsKey(node), slots);
  const additions = new Map<string, number>();
  for (const lease of [request, thread])
    for (const key of lease?.keys ?? []) additions.set(key, (additions.get(key) ?? 0) + lease!.weight);
  for (const [key, weight] of additions)
    if ((state.inFlight.get(key) ?? 0) + weight > (limits.get(key) ?? Infinity) + 1e-9) return null;
  for (const [key, weight] of additions) state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + weight);
  return { request, thread };
}

/** Limits used by the diagnostic oracle, including endpoints not yet called. */
export function admissionLimits(state: AdmissionState): Map<string, number> {
  const limits = new Map([...state.allocations].map(([id, cap]) => [sharedConcurrencyKey(id), cap]));
  for (const nodes of state.compiled.values())
    for (const node of nodes.values())
      for (const call of node.calls.values())
        for (const [key, cap] of call.limits) limits.set(key, Math.min(limits.get(key) ?? Infinity, cap));
  return limits;
}

/** Resume an already admitted request: reserve execution capacity without another quota transaction. */
export function reserveContinuation(
  state: AdmissionState,
  node: string,
  policy: AdmissionPolicy,
  weight: number,
  slots: number,
  partial: boolean,
  retained?: CallerOccupancy,
): AdmissionLease | undefined {
  const key = (state.compiled.get(policy.requirementsPolicy ?? policy)?.get(node) ?? compileNode(state, node, policy))
    .slots;
  const available = slots - (state.inFlight.get(key) ?? 0);
  if (available < Math.min(1, weight) || (!partial && available + 1e-9 < weight)) return undefined;
  const reservation = reserveCallerOccupancy(weight, available, retained);
  state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + reservation.weight);
  return { ...reservation, keys: [key] };
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
function compileNode(state: AdmissionState, node: string, policy: AdmissionPolicy): CompiledNode {
  const compiled: CompiledNode = {
    slots: slotsKey(node),
    calls: new Map([[undefined, normalizeCall(state, node, policy)]]),
  };
  for (const endpoint of policy.endpoints)
    compiled.calls.set(endpoint.id, normalizeCall(state, node, policy, endpoint));
  const cacheKey = policy.requirementsPolicy ?? policy;
  const nodes = state.compiled.get(cacheKey) ?? new Map<string, CompiledNode>();
  nodes.set(node, compiled);
  state.compiled.set(cacheKey, nodes);
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
      state.compiled.delete(previous.requirementsPolicy ?? previous);
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
        state.compiled.delete(policy.requirementsPolicy ?? policy);
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
  extra: readonly Requirement[] = [],
  partialOccupancy = false,
  retained?: AdmissionLeases,
):
  | { leases: AdmissionLeases & { thread: AdmissionLease }; latencyMs?: number; errorRate?: number }
  | { rejected: string } {
  const compiled =
    state.compiled.get(policy.requirementsPolicy ?? policy)?.get(node) ?? compileNode(state, node, policy);
  const call = compiled.calls.get(endpointId);
  if (!call) return { rejected: "unknown endpoint" };
  if (call.rejected) return { rejected: call.rejected };
  // A route rule's quotas join the node's in one transaction; a shared bucket named at both scopes is charged once.
  const requirements = transactionRequirements(call.requirements, extra);
  for (const { key, quota, cost } of requirements) {
    const bucket = bucketAt(state, key, quota, now);
    if (bucket.tokens + 1e-9 < weight * cost) return { rejected: `${quota.id}: ${quota.unit}` };
  }
  let occupancy = retained?.request.weight ?? weight;
  if (partialOccupancy && !retained) {
    if (slots !== undefined) occupancy = Math.min(occupancy, slots - (state.inFlight.get(compiled.slots) ?? 0));
    for (const [key, limit] of call.limits) occupancy = Math.min(occupancy, limit - (state.inFlight.get(key) ?? 0));
    if (occupancy < Math.min(1, weight)) return { rejected: "concurrency" };
  }
  if (!retained && slots !== undefined && (state.inFlight.get(compiled.slots) ?? 0) + occupancy > slots + 1e-9)
    return { rejected: "concurrency" };
  for (const [key, limit] of call.limits)
    if (!retained && (state.inFlight.get(key) ?? 0) + occupancy > limit + 1e-9) return { rejected: "concurrency" };
  for (const { key, cost } of requirements) state.buckets.get(key)!.tokens -= weight * cost;
  const keys = [...call.limits.keys(), ...(slots === undefined ? [] : [compiled.slots])];
  const reservation = reserveCallerOccupancy(weight, occupancy);
  const leases = separateAdmission({ keys, ...reservation }, slots === undefined ? undefined : compiled.slots);
  if (retained) {
    // Quotas and policy validation succeeded before any existing occupancy changes.
    // Request residence and execution can have different retained weights after a shrink.
    releaseAdmissions(state, retained);
    leases.request.weight = retained.request.weight;
    if (retained.thread) leases.thread.weight = retained.thread.weight;
  }
  for (const part of [leases.request, leases.thread])
    for (const key of part.keys) state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + part.weight);
  return {
    leases,
    latencyMs: call.latencyMs,
    errorRate: call.errorRate,
  };
}
/** Release exactly the request and execution occupancy charged by the transaction. */
export function releaseAdmissions(state: AdmissionState, leases: AdmissionLeases) {
  releaseAdmission(state, leases.request);
  releaseAdmission(state, leases.thread);
}
export function releaseAdmission(state: AdmissionState, lease?: AdmissionLease) {
  if (lease)
    for (const key of lease.keys) state.inFlight.set(key, Math.max(0, (state.inFlight.get(key) ?? 0) - lease.weight));
}
