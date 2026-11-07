import type { NodeSimState } from "../sim/types";

export const herdThreshold = (scale = 1) => Math.max(20, 4 * scale);
/** The same harm test for the live callout and Checks' Cold cache probe. */
export const cacheHarmed = (backlog: number, previousBacklog: number, p95: number, previousP95: number) =>
  backlog > previousBacklog || (previousP95 > 0 && p95 > 2 * previousP95);
export function cacheHerd(s: Pick<NodeSimState, "cacheDetails">, scale = 1) {
  const herd = s.cacheDetails?.herd;
  return herd && Math.max(herd.fetches, herd.waiting) >= (s.cacheDetails?.herdThreshold ?? herdThreshold(scale))
    ? herd
    : undefined;
}
