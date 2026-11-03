import type { CachePolicy } from "../../model/caching";
import { popularityTable } from "./popularity";

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
