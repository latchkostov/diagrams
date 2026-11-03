import type { NodeSimState } from "../sim/types";

export const herdThreshold = (scale = 1) => Math.max(20, 4 * scale);
export function cacheHerd(s: Pick<NodeSimState, "cacheDetails">, scale = 1) {
  const herd = s.cacheDetails?.herd;
  return herd && Math.max(herd.fetches, herd.waiting) >= (s.cacheDetails?.herdThreshold ?? herdThreshold(scale))
    ? herd
    : undefined;
}
