import type { NodeCache } from "./cache/cacheState";

/** Opt-in ownership oracle; ordinary playback never imports or executes it. */
export function assertCacheInvariants(
  cache: NodeCache,
  idle = false,
  calls?: Iterable<{ work: import("./engine/model").Work }>,
): void {
  const owned = new Set<string>();
  for (const { work } of calls ?? [])
    if (work.cacheFlight) {
      const key = `${work.cache?.rule?.id}:${work.cache?.item}`;
      if (owned.has(key) || work.message.represented !== 1) throw new Error("C3 multiple fetches for one item");
      owned.add(key);
    }
  const counts = cache.counts;
  if (idle && owned.size) throw new Error("C7 cache-owned calls remain after drain");
  for (const value of Object.values(counts))
    if (!Number.isFinite(value) || value < 0) throw new Error("C1 finite cache counters");
  if (Math.abs(counts.requests - counts.hits - counts.misses - counts.coalesced - counts.notCached) > 1e-6)
    throw new Error("C1 cache conservation");
  for (const rule of cache.rules) {
    if (rule.policy.noStore && (rule.counts.hits || rule.counts.fills)) throw new Error("C5 no-store");
    for (const value of rule.fetching) {
      if (!Number.isFinite(value) || value < 0) throw new Error("C2 in-flight fetch accounting");
      if (!calls && rule.policy.coalesce && value > 1) throw new Error("C3 multiple fetches for one item");
      if (idle && value !== 0) throw new Error("C7 fetches remain after drain");
    }
  }
  if (idle && cache.flights?.size) throw new Error("C7 waiters remain after drain");
}
