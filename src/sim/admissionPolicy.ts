import type { Quota } from "../model/admission";

/** Tagged identities shared by steady-state planning and simulation. IDs are opaque user content. */
export type AdmissionScope = readonly ["node"] | readonly ["endpoint", string];
export const quotaKey = (node: string, scope: AdmissionScope, quota: Quota) =>
  JSON.stringify(quota.sharedGroup ? ["shared", "quota", quota.sharedGroup] : [node, "quota", ...scope, quota.id]);
export const concurrencyKey = (node: string, scope: AdmissionScope) => JSON.stringify([node, "concurrency", ...scope]);
export const sharedConcurrencyKey = (id: string) => JSON.stringify(["shared", "concurrency", id]);
export const slotsKey = (node: string) => JSON.stringify([node, "slots"]);
export const quotaSignature = (q: Quota) =>
  JSON.stringify([q.unit, q.amount, q.windowMs, q.burst ?? q.amount, q.algorithm]);
