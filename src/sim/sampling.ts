/** Refine a fixed dot weight so every finite caller pool contains a whole number of dots.
 * Fractional weights preserve the requested sampling granularity where pools allow it. */
export function callerPoolScale(requested: number, pools: Iterable<number>): number {
  let common = 0;
  for (const pool of pools) {
    if (!Number.isSafeInteger(pool) || pool <= 0) continue;
    let a = common,
      b = pool;
    while (b) [a, b] = [b, a % b];
    common = a;
    if (common === 1) return 1;
  }
  return common ? Math.max(1, common / Math.ceil(common / requested)) : requested;
}
