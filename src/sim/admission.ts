import type { ApiBehaviour, ApiEndpoint, Quota } from "../model/admission";
import type { RetryPolicy } from "../model/admission";

/** Concurrency-like, whole-dot gate until throttle splitting lands: overshoot is less than one dot. */
export function breakerProbePermits(room: number, represented: number): boolean {
  return allocationWeight(represented, room) + 1e-9 >= Math.min(1, represented);
}

/** Token-like gate: a retry either spends its whole represented cohort or nothing. */
export function retryBudgetPermits(
  budget: RetryPolicy["budget"],
  requests: number,
  retried: number,
  represented: number,
): boolean {
  return (
    !budget ||
    retried + represented <= Math.max((budget.minPerSec ?? 10) * 10, (budget.percent / 100) * requests) + 1e-9
  );
}
import type { PlanningModel } from "../model/types";
import { allocationWeight, reserveCallerOccupancy, type CallerOccupancy } from "./ledger";
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

/** The execution ceiling also bounds callers whose older request leases predate a live cap. */
export function admissionSlots(policy: AdmissionPolicy, activeReplicas = Infinity): number {
  return Math.min(
    policy.slots ?? Infinity,
    policy.api.maxInFlight ?? Infinity,
    policy.fixedSlotsPerReplica === undefined ? Infinity : activeReplicas * policy.fixedSlotsPerReplica,
  );
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
  /** Occupancy retained across a live cap reduction; releases consume this allowance. */
  retainedExcess: Map<string, number>;
  conflicts: Set<string>;
  allocations: Map<string, number>;
  sharedQuotas: Map<string, Quota>;
  explicitAllocations: Map<string, number>;
  definitions: Map<string, Map<AdmissionPolicy, Set<string | number>>>;
  policies: Map<string, AdmissionPolicy>;
  compiled: Map<AdmissionPolicy, Map<string, CompiledNode>>;
  owners: Map<AdmissionPolicy, string>;
  /** Incremental diagnostic limits: policy edits only revisit their own keys. */
  nodeLimits: Map<string, Map<string, number>>;
  limitOwners: Map<string, Map<string, number>>;
  limits: Map<string, number>;
  dirtyLimits: Set<string>;
}
export const emptyAdmission = (): AdmissionState => ({
  buckets: new Map(),
  inFlight: new Map(),
  retainedExcess: new Map(),
  conflicts: new Set(),
  allocations: new Map(),
  sharedQuotas: new Map(),
  explicitAllocations: new Map(),
  definitions: new Map(),
  policies: new Map(),
  compiled: new Map(),
  owners: new Map(),
  nodeLimits: new Map(),
  limitOwners: new Map(),
  limits: new Map(),
  dirtyLimits: new Set(),
});
/** Checkpoint replacement keeps admission state mutations within its owner. */
export function restoreAdmission(
  state: AdmissionState,
  saved: Pick<AdmissionState, "buckets" | "inFlight" | "retainedExcess">,
): void {
  state.buckets = saved.buckets;
  state.inFlight = saved.inFlight;
  state.retainedExcess = saved.retainedExcess;
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

/** Real requests of room left under every limit (Infinity without one). */
function roomOf(state: AdmissionState, limits: ReadonlyMap<string, number>): number {
  let room = Infinity;
  for (const [key, cap] of limits) room = Math.min(room, cap - (state.inFlight.get(key) ?? 0));
  return room;
}

/**
 * The throttle split, at one instant at scale > 1: a concurrency limit with room for w < N real
 * requests admits a partial dot of w, held at full weight (no stretch), and refuses a sibling partial
 * dot of N - w, as scale 1 admits w members of the burst and rejects the rest. A dot that fits is never
 * split. Null: room for less than min(1, N) real requests, so the whole dot is refused. Shortfalls in
 * execution slots queue instead (stretch), and token-bucket quotas stay whole-dot. Shared by admission,
 * queue-limit shedding and half-open probes.
 */
export function throttleSplit(represented: number, room: number): { admitted: number; refused: number } | null {
  // Packing a dot that fits (allocationWeight) would refuse requests an idle throttle admits at scale 1.
  const admitted = room + 1e-9 >= represented ? represented : allocationWeight(represented, room);
  if (!(admitted + 1e-9 >= Math.min(1, represented))) return null;
  return { admitted, refused: represented - admitted > 1e-9 ? represented - admitted : 0 };
}

/** One capacity decision for fresh attempts, continuations and outage recovery. No side effects. */
function allocate(
  state: AdmissionState,
  limits: ReadonlyMap<string, number>,
  {
    represented,
    maxWeight = represented,
    partial = true,
  }: { represented: number; maxWeight?: number; partial?: boolean },
): number | null {
  const room = roomOf(state, limits);
  let weight = partial ? allocationWeight(represented, room, maxWeight) : Math.min(represented, maxWeight, room);
  const minimum = Math.min(1, represented);
  if (weight + 1e-9 < minimum) return null;
  weight = Math.max(weight, minimum);
  if (!partial) return weight + 1e-9 < maxWeight ? null : maxWeight;
  return weight;
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
  const request = capacity.request ? { ...capacity.request, keys: [...(call?.limits.keys() ?? [])] } : undefined;
  const thread = {
    ...capacity.thread,
    keys: policy ? [slotsKey(node)] : [],
  };
  const limits = new Map(call?.limits);
  limits.set(slotsKey(node), slots);
  // Decide both parts before charging either. Request residence and execution
  // can have different weights, but a thread never exceeds its request.
  const requestWeight =
    request &&
    allocate(state, new Map(request.keys.map((key) => [key, limits.get(key) ?? Infinity])), {
      represented: request.represented,
      maxWeight: request.weight,
    });
  if (requestWeight === null) return null;
  const threadWeight = allocate(state, new Map(thread.keys.map((key) => [key, limits.get(key) ?? Infinity])), {
    represented: thread.represented,
    maxWeight: Math.min(thread.weight, room, requestWeight ?? Infinity),
  });
  if (threadWeight === null) return null;
  if (request) request.weight = requestWeight!;
  thread.weight = threadWeight;
  const additions = new Map<string, number>();
  for (const lease of [request, thread])
    for (const key of lease?.keys ?? []) additions.set(key, (additions.get(key) ?? 0) + lease!.weight);
  for (const [key, weight] of additions) state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + weight);
  return { request, thread };
}

/** Limits used by the diagnostic oracle, including endpoints not yet called. */
export function admissionLimits(state: AdmissionState): Map<string, number> {
  refreshLimits(state);
  return new Map(
    [...state.allocations].map(([id, cap]) => [sharedConcurrencyKey(id), cap] as const).concat([...state.limits]),
  );
}

function updateLimits(state: AdmissionState, node: string, limits: Map<string, number>): void {
  const keys = new Set([...(state.nodeLimits.get(node)?.keys() ?? []), ...limits.keys()]);
  for (const key of keys) {
    const owners = state.limitOwners.get(key) ?? new Map<string, number>();
    const cap = limits.get(key);
    if (cap === undefined) owners.delete(node);
    else owners.set(node, cap);
    if (owners.size) state.limitOwners.set(key, owners);
    else state.limitOwners.delete(key);
    state.dirtyLimits.add(key);
  }
  if (limits.size) state.nodeLimits.set(node, limits);
  else state.nodeLimits.delete(node);
}

/** Configuration batches touch owner maps first, then refresh each aggregate once. */
function refreshLimits(state: AdmissionState): void {
  for (const key of state.dirtyLimits) {
    let current = Infinity;
    for (const cap of state.limitOwners.get(key)?.values() ?? []) current = Math.min(current, cap);
    if (current === Infinity) state.limits.delete(key);
    else state.limits.set(key, current);
    const excess = (state.inFlight.get(key) ?? 0) - current;
    if (excess > 0) state.retainedExcess.set(key, excess);
    else state.retainedExcess.delete(key);
  }
  state.dirtyLimits.clear();
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
  const granted = allocate(state, new Map([[key, slots]]), {
    represented: weight,
    maxWeight: Math.min(weight, retained?.weight ?? Infinity),
    partial,
  });
  if (granted === null) return undefined;
  const reservation = reserveCallerOccupancy(weight, granted);
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
  state.nodeLimits.clear();
  state.limitOwners.clear();
  state.limits.clear();
  state.dirtyLimits.clear();
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
  const limits = new Map<string, number>();
  for (const call of compiled.calls.values())
    for (const [key, cap] of call.limits) limits.set(key, Math.min(limits.get(key) ?? Infinity, cap));
  updateLimits(state, node, limits);
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
    } else {
      state.policies.delete(id);
      updateLimits(state, id, new Map());
    }
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
  refreshLimits(state);
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
  executionRoom = Infinity,
  /** The caller can refuse a sibling partial dot (the throttle split) instead of stretching this one. */
  split = false,
):
  | {
      leases: AdmissionLeases & { thread: AdmissionLease };
      latencyMs?: number;
      errorRate?: number;
      /** Real requests of a sibling partial dot this transaction refused (the throttle split). */
      refused?: number;
    }
  | { rejected: string; waiting?: boolean } {
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
  const limits = new Map(call.limits);
  if (slots !== undefined) limits.set(compiled.slots, slots);
  // A retry keeps existing occupancy even after a shrink. Newly added keys
  // still need capacity; keeping an old lease is not a new allocation.
  const held = new Set([...(retained?.request.keys ?? []), ...(retained?.thread?.keys ?? [])]);
  const free = new Map([...limits].filter(([key]) => !held.has(key)));
  // Every limit here refuses at scale 1 (node and endpoint maxInFlight, shared concurrency, and the
  // slots key: a managed node's reserved concurrency), so a partial grant splits rather than stretches.
  const part = split && partialOccupancy && !retained ? throttleSplit(weight, roomOf(state, free)) : undefined;
  const occupancy =
    part === undefined
      ? allocate(state, free, {
          represented: weight,
          maxWeight: retained?.request.weight ?? weight,
          partial: partialOccupancy && !retained,
        })
      : part && part.admitted;
  if (occupancy === null) return { rejected: "concurrency" };
  const admitted = part ? part.admitted : weight;
  if (!retained?.thread && executionRoom + 1e-9 < Math.min(1, admitted))
    return { rejected: "concurrency", waiting: true };
  const executionWeight = retained?.thread ? occupancy : Math.min(occupancy, executionRoom);
  // A refused sibling never entered: like the members scale 1 rejects, it spends no quota.
  for (const { key, cost } of requirements) state.buckets.get(key)!.tokens -= admitted * cost;
  const keys = [...call.limits.keys(), ...(slots === undefined ? [] : [compiled.slots])];
  const reservation = reserveCallerOccupancy(admitted, executionWeight);
  const leases = separateAdmission({ keys, ...reservation }, slots === undefined ? undefined : compiled.slots);
  if (retained) {
    // Quotas and policy validation succeeded before any existing occupancy changes.
    // Request residence and execution can have different retained weights after a shrink.
    leases.request.weight = retained.request.weight;
    if (retained.thread) leases.thread.weight = retained.thread.weight;
    const currentKeys = new Set(keys);
    for (const part of [retained.request, retained.thread])
      if (part) releaseAdmission(state, { ...part, keys: part.keys.filter((key) => !currentKeys.has(key)) });
  }
  for (const part of [leases.request, leases.thread])
    for (const key of part.keys)
      if (!held.has(key)) state.inFlight.set(key, (state.inFlight.get(key) ?? 0) + part.weight);
  return {
    leases,
    latencyMs: call.latencyMs,
    errorRate: call.errorRate,
    refused: part?.refused,
  };
}
/** Release exactly the request and execution occupancy charged by the transaction. */
export function releaseAdmissions(state: AdmissionState, leases: AdmissionLeases) {
  releaseAdmission(state, leases.request);
  releaseAdmission(state, leases.thread);
}
export function releaseAdmission(state: AdmissionState, lease?: AdmissionLease) {
  if (lease)
    for (const key of lease.keys) {
      // Fractional leases can leave round-off after their last owner releases.
      // A sub-request residue must not make an empty one-slot pool unusable.
      const remaining = (state.inFlight.get(key) ?? 0) - lease.weight;
      state.inFlight.set(key, remaining > 1e-9 ? remaining : 0);
      const excess = state.retainedExcess.get(key);
      if (excess !== undefined) {
        if (excess > lease.weight) state.retainedExcess.set(key, excess - lease.weight);
        else state.retainedExcess.delete(key);
      }
    }
}
