import type { EdgeSimState } from "../sim/types";

/** Settled attempts since restart, excluding local breaker rejections on both sides.
 * Started attempts are a different population: replies may arrive after their start window expires. */
export function callFailureRate(
  calls: Partial<Pick<NonNullable<EdgeSimState["calls"]>, "failed" | "shortCircuited" | "succeeded">> | undefined,
) {
  const failed = (calls?.failed ?? 0) - (calls?.shortCircuited ?? 0);
  const total = failed + (calls?.succeeded ?? 0);
  return { failed, total, rate: total > 0 ? failed / total : 0 };
}
