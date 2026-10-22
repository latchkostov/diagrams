import type { AdmissionPolicy, AdmissionState } from "./admission";
import type { ApiBehaviour, ApiEndpoint, Quota } from "../model/admission";

/** Endpoint overrides inherit the node API's latency, errors and individual workload costs. */
export function resolveApiBehaviour(api: ApiBehaviour, endpoint?: ApiEndpoint) {
  return {
    latencyMs: endpoint?.behaviour?.latencyMs ?? api.latencyMs,
    errorRate: endpoint?.behaviour?.errorRate ?? api.errorRate,
    costPerRequest: { ...api.costPerRequest, ...endpoint?.behaviour?.costPerRequest },
  };
}

/** Tagged identities shared by steady-state planning and simulation. IDs are opaque user content. */
export type AdmissionScope = readonly ["node"] | readonly ["endpoint", string] | readonly ["rule", string];
export const quotaKey = (node: string, scope: AdmissionScope, quota: Quota) =>
  JSON.stringify(
    quota.sharedGroup ? ["shared", "quota", quota.sharedGroup] : ["local", node, "quota", ...scope, quota.id],
  );
export const concurrencyKey = (node: string, scope: AdmissionScope) =>
  JSON.stringify(["local", node, "concurrency", ...scope]);
export const sharedConcurrencyKey = (id: string) => JSON.stringify(["shared", "concurrency", id]);
export const slotsKey = (node: string) => JSON.stringify(["local", node, "slots"]);
export const quotaSignature = (q: Quota) =>
  JSON.stringify([q.unit, q.amount, q.windowMs, q.burst ?? q.amount, q.algorithm]);

/** Requirements by bucket key, first declaration kept: a bucket named twice (two aliases of one shared quota) is
 * checked and charged once per attempt, whichever admission path charges it. */
export function uniqueRequirements<R extends { key: string }>(requirements: readonly R[]): R[] {
  const seen = new Set<string>();
  return requirements.filter((r) => !seen.has(r.key) && !!seen.add(r.key));
}

export interface Requirement {
  key: string;
  quota: Quota;
  cost: number;
}

/**
 * One admission transaction's buckets: the call's (node and endpoint) and the matched route rule's, a bucket named at
 * both scopes charged once. Playback (attemptAdmission) and planning (admissionPlan) compose them here alike.
 */
export function transactionRequirements<R extends { key: string }>(
  call: readonly R[],
  rule: readonly R[],
): readonly R[] {
  return rule.length ? uniqueRequirements([...call, ...rule]) : call;
}
export interface CompiledCall {
  rejected?: string;
  requirements: Requirement[];
  limits: Map<string, number>;
  latencyMs?: number;
  errorRate?: number;
}

export function normalizeCall(
  state: Pick<AdmissionState, "conflicts" | "sharedQuotas" | "allocations">,
  node: string,
  policy: AdmissionPolicy,
  endpoint?: ApiEndpoint,
): CompiledCall {
  const behaviour = endpoint?.behaviour;
  const effective = resolveApiBehaviour(policy.api, endpoint);
  const call: CompiledCall = {
    requirements: [],
    limits: new Map(),
    latencyMs: effective.latencyMs,
    errorRate: effective.errorRate,
  };
  if (policy.invalid) {
    call.rejected = "invalid admission data";
    return call;
  }
  const costs = effective.costPerRequest;
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
