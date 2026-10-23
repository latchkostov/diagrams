import type { EdgeSimState } from "../sim/types";

export type CallFailureRate = { available: false } | { available: true; failed: number; total: number; rate: number };

/** Settled attempts since restart, excluding local breaker rejections on both sides.
 * Started attempts are a different population: replies may arrive after their start window expires. */
export function callFailureRate(
  calls: Partial<Pick<NonNullable<EdgeSimState["calls"]>, "failed" | "shortCircuited" | "succeeded">> | undefined,
): CallFailureRate {
  // Ordinary requests and older models do not publish settled-success accounting.
  // Their failure count alone cannot establish the denominator.
  if (calls?.succeeded === undefined) return { available: false };
  const failed = (calls?.failed ?? 0) - (calls?.shortCircuited ?? 0);
  const total = failed + calls.succeeded;
  return { available: true, failed, total, rate: total > 0 ? failed / total : 0 };
}
