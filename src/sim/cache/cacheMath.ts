import type { CachePolicy } from "../../model/caching";
import { popularityTable } from "./popularity";
import { cacheTrackingEligible } from "./tracking";

/** e^-x: fixed Taylor polynomial on [0, 1/8], followed by deterministic squaring. */
export function expNeg(x: number): number {
  if (x <= 0) return 1;
  if (x >= 746) return 0;
  let halves = 0;
  while (x > 0.125) {
    x /= 2;
    halves++;
  }
  let term = 1,
    sum = 1;
  for (let i = 1; i <= 12; i++) {
    term *= -x / i;
    sum += term;
  }
  for (let i = 0; i < halves; i++) sum *= sum;
  return sum;
}
export function itemHitShare(rate: number, ttlMs: number, fetchMs: number): number {
  if (!(rate > 0) || !Number.isFinite(fetchMs)) return 0;
  const fresh = (rate * ttlMs) / 1000;
  return fresh / (1 + (rate * fetchMs) / 1000 + fresh);
}
export function cacheHitShare(policy: CachePolicy, rate: number, fetchMs: number): number {
  if (policy.noStore || !policy.ttlMs || !(rate > 0)) return 0;
  return popularityTable(policy.keys, policy.popularity).bands.reduce(
    (sum, band) => sum + band.share * itemHitShare((rate * band.share) / band.count, policy.ttlMs!, fetchMs),
    0,
  );
}

/** Fresh hits stay unchanged. Tracked miss cohorts share one fetch per fill cycle. */
export function cacheFetchShare(policy: CachePolicy, rate: number, fetchMs: number, tracked = 256): number {
  if (!policy.coalesce || !tracked || !cacheTrackingEligible(rate, policy.ttlMs!))
    return 1 - cacheHitShare(policy, rate, fetchMs);
  if (policy.noStore || !policy.ttlMs || !(rate > 0) || !Number.isFinite(fetchMs)) return 1;
  return popularityTable(policy.keys, policy.popularity).bands.reduce((sum, band) => {
    const itemRate = (rate * band.share) / band.count;
    const share =
      band.first < tracked
        ? 1 / (1 + (itemRate * (fetchMs + policy.ttlMs!)) / 1000)
        : 1 - itemHitShare(itemRate, policy.ttlMs!, fetchMs);
    return sum + band.share * share;
  }, 0);
}
