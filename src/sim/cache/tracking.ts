import { STEP } from "../timing";

/** A tick must be at most 2% of a tracked freshness interval. */
export function cacheTrackingEligible(rate: number, ttlMs: number): boolean {
  return !(rate > 0 && ttlMs < 50 * STEP);
}
