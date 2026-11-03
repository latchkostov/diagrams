import { checkCache, CACHE_LIMITS, type CacheTable } from "../../model/caching";
import { compileMatch, matchesRequest, drawStream, streamSeed } from "../routeMatching";
import { acceptsType } from "../topology";
import { cacheHitShare, itemHitShare, expNeg } from "./cacheMath";
import { popularityTable } from "./popularity";
import { installCacheRuntime, type CacheRuntime } from "./cacheBridge";
import type { CacheCounts, CacheRuleState } from "./cacheState";
import { cachePlan } from "./planning";
import { cacheScale } from "./cacheScale";
import { analyzeCapacity } from "../capacity";
import { latencyMetrics } from "../latency";
import type { NodeCache } from "./cacheState";

type ActiveItem = { rule: CacheRuleState; item: number; order: number };
type Summary = { herd?: import("./cacheState").CacheDetails["herd"]; itemFetches: number };
// Derived state never enters checkpoints. A restored cache builds its index once;
// subsequent reads visit only active items, and share a summary until work changes.
const summaries = new WeakMap<NodeCache, { active: Map<string, ActiveItem>; value?: Summary }>();
function summaryState(cache: NodeCache) {
  let state = summaries.get(cache);
  if (!state) {
    const active = new Map<string, ActiveItem>();
    cache.rules.forEach((rule, order) => {
      for (let item = 0; item < rule.tracked; item++)
        if (rule.fetching[item]) active.set(`${rule.id}:${item}`, { rule, item, order });
    });
    state = { active };
    summaries.set(cache, state);
  }
  return state;
}
function summary(cache: NodeCache): Summary {
  const state = summaryState(cache);
  if (state.value) return state.value;
  let herd: Summary["herd"],
    best: ActiveItem | undefined,
    itemFetches = 0;
  for (const active of state.active.values()) {
    const { rule, item } = active;
    const candidate = cacheRuntime.observeItem(cache, rule.id, item + 1)!;
    itemFetches = Math.max(itemFetches, candidate.fetches);
    // Independent-fetch trouble wins over a larger, harmless held-waiter herd.
    const priority = (value: NonNullable<Summary["herd"]>) => (value.fetches >= cache.herdThreshold ? 1 : 0);
    if (
      !herd ||
      priority(candidate) > priority(herd) ||
      (priority(candidate) === priority(herd) &&
        (Math.max(candidate.fetches, candidate.waiting) > Math.max(herd.fetches, herd.waiting) ||
          (Math.max(candidate.fetches, candidate.waiting) === Math.max(herd.fetches, herd.waiting) &&
            (active.order < best!.order || (active.order === best!.order && item < best!.item)))))
    ) {
      herd = candidate;
      best = active;
    }
  }
  return (state.value = { herd, itemFetches });
}

function windowBucket(cache: NodeCache, now: number): number {
  const second = Math.floor(now / 1000);
  const ring = (cache.window ??= { second, buckets: new Float64Array(40) });
  if (second - ring.second >= 10) ring.buckets.fill(0);
  else for (let s = ring.second + 1; s <= second; s++) ring.buckets.fill(0, (s % 10) * 4, (s % 10) * 4 + 4);
  ring.second = second;
  return (second % 10) * 4;
}

const zeroCounts: CacheCounts = Object.freeze({
  requests: 0,
  hits: 0,
  misses: 0,
  coalesced: 0,
  notCached: 0,
  fetches: 0,
  fills: 0,
});
const counts = (): CacheCounts => ({ ...zeroCounts });
// Keep the existing cumulative report shape when no requests were collapsed.
const reportCounts = ({ coalesced, ...rest }: CacheCounts) => ({ ...rest, ...(coalesced ? { coalesced } : {}) });
const initialRates = new Map<number, CacheRuleState["rate"]>();
const initialFetches = new Map<number, CacheRuleState["fetchMs"]>();
function initialRate(planned: number): CacheRuleState["rate"] {
  let state = initialRates.get(planned);
  if (!state) {
    const buckets = new Float64Array(10).fill(planned);
    buckets[0] = 0;
    state = Object.freeze({ buckets, second: 0, planned });
    if (initialRates.size >= 256) initialRates.clear();
    initialRates.set(planned, state);
  }
  return state;
}
function initialFetch(planned: number): CacheRuleState["fetchMs"] {
  let state = initialFetches.get(planned);
  if (!state) {
    state = Object.freeze({ samples: new Float64Array(32), cursor: 0, count: 0, sum: 0, planned });
    if (initialFetches.size >= 256) initialFetches.clear();
    initialFetches.set(planned, state);
  }
  return state;
}
function draw(rule: CacheRuleState): number {
  const next = drawStream(rule.stream);
  rule.stream = next.state;
  return next.value;
}
function rate(rule: CacheRuleState, now: number, size: number): number {
  if (Object.isFrozen(rule.rate)) rule.rate = { ...rule.rate, buckets: rule.rate.buckets.slice() };
  const second = Math.floor(now / 1000),
    ring = rule.rate;
  if (second - ring.second >= 10) ring.buckets.fill(0);
  else for (let s = ring.second + 1; s <= second; s++) ring.buckets[s % 10] = 0;
  ring.second = second;
  ring.buckets[second % 10] += size;
  // Nine complete buckets plus this partial second. Dividing by ten here biases
  // every statistical band's rate downward at every second boundary.
  const span = 9 + (now % 1000) / 1000;
  return ring.buckets.reduce((a, b) => a + b, 0) / Math.max(0.01, ring.planned > 0 ? span : Math.min(span, now / 1000));
}
export const cacheRuntime: CacheRuntime = {
  reconfigure(cache, value) {
    checkCache(value);
    const table = value as CacheTable;
    const next = [...table.rules, ...(table.default ? [{ id: "", match: undefined, policy: table.default }] : [])];
    if (!cache.rules.some((r) => r.policy.coalesce) && !next.some((r) => r.policy.coalesce)) return false;
    if (next.length !== cache.rules.length) return false;
    for (let i = 0; i < next.length; i++) {
      const before = cache.rules[i],
        after = next[i];
      const { types, ...address } = after.match ?? {};
      const oldPolicy = before.policy,
        newPolicy = after.policy;
      if (
        before.id !== after.id ||
        oldPolicy.ttlMs !== newPolicy.ttlMs ||
        oldPolicy.noStore !== newPolicy.noStore ||
        oldPolicy.keys !== newPolicy.keys ||
        oldPolicy.popularity !== newPolicy.popularity ||
        JSON.stringify(before.match) !== JSON.stringify(after.match ? compileMatch(address) : undefined) ||
        JSON.stringify(before.types) !== JSON.stringify(types)
      )
        return false;
    }
    // Keep the same rule identities: in-flight fills and parked waiters still own them.
    for (let i = 0; i < next.length; i++) cache.rules[i].policy = next[i].policy;
    return true;
  },
  compile(value, node, seed, scale, remaining, rates) {
    checkCache(value);
    const table = value as CacheTable;
    const cache: NodeCache = {
      herdThreshold: Math.max(20, 4 * scale),
      expected: 0,
      counts: counts(),
      rules: [...table.rules, ...(table.default ? [{ id: "", match: undefined, policy: table.default }] : [])].map(
        (rule) => {
          const { types, ...address } = rule.match ?? {};
          const planned = rates?.[rule.id]?.rate ?? 0,
            fetchMs = rates?.[rule.id]?.fetchMs ?? 0;
          const popularity = rule.policy.noStore
            ? undefined
            : popularityTable(rule.policy.keys, rule.policy.popularity);
          let tracked = 0;
          for (const band of popularity?.bands ?? []) {
            if (
              band.first >= CACHE_LIMITS.tracked ||
              band.count !== 1 ||
              !remaining.value ||
              (scale > 1 && (planned * band.share * rule.policy.ttlMs!) / 1000 / scale < 50)
            )
              break;
            tracked++;
            remaining.value--;
          }
          const freshUntil = new Float64Array(tracked);
          let warm = streamSeed(seed, node, `cache-warm:${rule.id}`);
          for (let i = 0; i < tracked; i++) {
            const hit = drawStream(warm);
            const ttl = drawStream(hit.state);
            warm = ttl.state;
            if (hit.value < itemHitShare(planned * popularity!.bands[i].share, rule.policy.ttlMs!, fetchMs))
              freshUntil[i] = ttl.value * rule.policy.ttlMs!;
          }
          return {
            id: rule.id,
            match: rule.match ? compileMatch(address) : undefined,
            address: Object.keys(address).length > 0,
            types,
            policy: rule.policy,
            popularity,
            stream: streamSeed(seed, node, `cache:${rule.id}`),
            tracked,
            statisticalUntil: rates && planned > 0 ? (rule.policy.ttlMs ?? 0) : 0,
            freshUntil,
            fetching: new Float64Array(tracked),
            rate: initialRate(planned),
            fetchMs: initialFetch(fetchMs),
            counts: zeroCounts,
            ...(rates ? {} : { warmSince: 0 }),
          };
        },
      ),
    };
    cacheRuntime.updateExpected(cache, rates ?? {});
    return cache;
  },
  updateExpected(cache, rates) {
    let expected = 0,
      total = 0;
    for (const rule of cache.rules) {
      const planned = rates[rule.id]?.rate ?? 0;
      const fetchMs = rates[rule.id]?.fetchMs ?? 0;
      // Keep contents, observations and random streams; only configured inputs change.
      if (rule.rate.planned !== planned) rule.rate = { ...rule.rate, buckets: rule.rate.buckets.slice(), planned };
      if (rule.fetchMs.planned !== fetchMs)
        rule.fetchMs = { ...rule.fetchMs, samples: rule.fetchMs.samples.slice(), planned: fetchMs };
      if (!rule.policy.noStore) {
        total += planned;
        expected += planned * cacheHitShare(rule.policy, planned, fetchMs);
      }
    }
    cache.expected = total ? expected / total : 0;
  },
  lookup(cache, type, request, sync, now, size) {
    const rule = cache.rules.find(
      (r) => !r.match || ((!r.address || matchesRequest(r.match, request)) && acceptsType(r.types, type)),
    );
    if (rule && Object.isFrozen(rule.counts)) rule.counts = counts();
    const add = (key: keyof CacheCounts) => {
      cache.counts[key] += size;
      if (rule) rule.counts[key] += size;
    };
    add("requests");
    const bucket = windowBucket(cache, now);
    cache.window!.buckets[bucket] += size;
    if (!sync || (request && request.method !== "GET" && request.method !== "HEAD") || !rule || rule.policy.noStore) {
      add("notCached");
      return { rule, item: -1, outcome: "not-cached", at: now };
    }
    const currentRate = rate(rule, now, size),
      bands = rule.popularity!.bands;
    const pick = draw(rule);
    let low = 0,
      high = bands.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (pick < bands[mid].cumulative) high = mid;
      else low = mid + 1;
    }
    const band = bands[low],
      item = band.first < rule.tracked ? band.first : -1;
    const mean = rule.fetchMs.count ? rule.fetchMs.sum / rule.fetchMs.count : rule.fetchMs.planned;
    const itemRate = (currentRate * band.share) / band.count;
    const steady = itemHitShare(itemRate, rule.policy.ttlMs!, mean);
    const share =
      rule.warmSince === undefined
        ? steady
        : Math.min(steady, 1 - expNeg((itemRate * Math.max(0, now - rule.warmSince - mean)) / 1000));
    const hit = item >= 0 ? now < rule.freshUntil[item] : draw(rule) < (now < rule.statisticalUntil ? share : 0);
    add(hit ? "hits" : "misses");
    cache.window!.buckets[bucket + (hit ? 1 : 2)] += size;
    return {
      rule,
      item,
      outcome: hit ? "hit" : "miss",
      at: now,
      ...(item >= 0 ? { freshUntil: rule.freshUntil[item] } : {}),
    };
  },
  start(cache, lookup, size, now) {
    if (lookup.fetching || lookup.outcome === "hit") return;
    lookup.fetching = true;
    if (now !== undefined) lookup.at = now;
    cache.counts.fetches += size;
    const bucket = windowBucket(cache, now ?? lookup.at);
    cache.window!.buckets[bucket + 3] += size;
    if (lookup.rule) lookup.rule.counts.fetches += size;
    if (lookup.rule && lookup.item >= 0) {
      const fetches = (lookup.rule.fetching[lookup.item] += size);
      const state = summaryState(cache);
      state.active.set(`${lookup.rule.id}:${lookup.item}`, {
        rule: lookup.rule,
        item: lookup.item,
        order: cache.rules.indexOf(lookup.rule),
      });
      state.value = undefined;
      if (fetches > (cache.peakHerd?.fetches ?? 0))
        cache.peakHerd = { rule: lookup.rule.id, item: lookup.item + 1, fetches, edge: lookup.origin };
      if (fetches >= cache.herdThreshold && fetches - size < cache.herdThreshold) {
        (cache.herds ??= new Map()).set(`${lookup.rule.id}:${lookup.item}`, {
          expiredAt: lookup.freshUntil ?? lookup.at,
          edge: lookup.origin,
        });
        return fetches;
      }
    }
  },
  settle(cache, lookup, now, size, ok) {
    if (!lookup.fetching) return;
    lookup.fetching = undefined;
    const rule = lookup.rule;
    if (!rule) return;
    if (lookup.item >= 0) rule.fetching[lookup.item] = Math.max(0, rule.fetching[lookup.item] - size);
    if (lookup.item >= 0) {
      const state = summaryState(cache);
      if (!rule.fetching[lookup.item]) state.active.delete(`${rule.id}:${lookup.item}`);
      state.value = undefined;
    }
    if (lookup.item >= 0 && !rule.fetching[lookup.item]) cache.herds?.delete(`${rule.id}:${lookup.item}`);
    if (!ok || lookup.outcome !== "miss") return;
    if (Object.isFrozen(rule.fetchMs)) rule.fetchMs = { ...rule.fetchMs, samples: rule.fetchMs.samples.slice() };
    const mean = rule.fetchMs,
      duration = now - lookup.at;
    if (mean.count === mean.samples.length) mean.sum -= mean.samples[mean.cursor];
    else mean.count++;
    mean.samples[mean.cursor] = duration;
    mean.sum += duration;
    mean.cursor = (mean.cursor + 1) % mean.samples.length;
    // Statistical freshness is approximate, but only successful replies can renew it.
    if (lookup.item < 0) rule.statisticalUntil = now + rule.policy.ttlMs!;
    if (lookup.item >= 0 && now >= rule.freshUntil[lookup.item]) {
      rule.freshUntil[lookup.item] = now + rule.policy.ttlMs!;
      rule.counts.fills++;
      cache.counts.fills++;
    }
  },
  read(cache) {
    const c = cache.counts,
      cacheable = c.hits + c.misses + c.coalesced;
    return {
      ...reportCounts(c),
      hitRatio: cacheable ? c.hits / cacheable : 0,
      originOffload: c.requests ? 1 - c.fetches / c.requests : 0,
      rules: Object.fromEntries(cache.rules.map((r) => [r.id, reportCounts(r.counts)])),
    };
  },
  itemFetches(cache) {
    return summary(cache).itemFetches;
  },
  invalidateSummary(cache) {
    const state = summaries.get(cache);
    if (state) state.value = undefined;
  },
  observeItem(cache, id, item) {
    const rule = cache.rules.find((r) => r.id === id);
    if (!rule || !Number.isInteger(item) || item < 1 || item > rule.tracked) return;
    const index = item - 1,
      key = `${id}:${index}`,
      flight = cache.flights?.get(key),
      episode = cache.herds?.get(key);
    return {
      rule: id,
      item,
      fetches: rule.fetching[index],
      waiting: flight?.cacheFlight?.waiting ?? 0,
      expiredAt: episode?.expiredAt ?? flight?.cache?.freshUntil ?? rule.freshUntil[index],
      edge: episode?.edge ?? flight?.cache?.origin,
    };
  },
  window(cache, now) {
    if (!cache.window) return;
    const totals = [0, 0, 0, 0];
    const second = Math.floor(now / 1000);
    for (let s = Math.max(0, second - 9); s <= cache.window.second; s++)
      for (let i = 0; i < 4; i++) totals[i] += cache.window.buckets[(s % 10) * 4 + i];
    return {
      requests: totals[0],
      hits: totals[1],
      misses: totals[2],
      fetches: totals[3],
      seconds: Math.min(10, Math.max(0.01, now / 1000)),
    };
  },
  details(cache, now) {
    const latency = cache.latency && latencyMetrics(cache.latency);
    const { herd, itemFetches } = summary(cache);
    const window = cacheRuntime.window(cache, now);
    return {
      expected: cache.expected,
      herdThreshold: cache.herdThreshold,
      itemFetches,
      ...(cache.peakHerd ? { peakHerd: cache.peakHerd } : {}),
      ...(herd ? { herd: { ...herd } } : {}),
      ...(window ? { window } : {}),
      ...(latency ? { latency: { total: latency, hit: latency.byType.hit, miss: latency.byType.miss } } : {}),
    };
  },
  plan: cachePlan,
  scale: (diagram, simulation, scale) =>
    cacheScale(diagram, simulation, scale, analyzeCapacity(diagram, simulation).cacheDemand ?? {}),
};
installCacheRuntime(cacheRuntime);
