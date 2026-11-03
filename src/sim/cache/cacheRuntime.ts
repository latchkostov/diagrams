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
import { STEP } from "../timing";
import { latencyMetrics } from "../latency";
import type { NodeCache } from "./cacheState";

function windowBucket(cache: NodeCache, now: number): number {
  const second = Math.floor(now / 1000);
  const ring = (cache.window ??= { second, buckets: new Float64Array(40) });
  if (second - ring.second >= 10) ring.buckets.fill(0);
  else for (let s = ring.second + 1; s <= second; s++) ring.buckets.fill(0, (s % 10) * 4, (s % 10) * 4 + 4);
  ring.second = second;
  return (second % 10) * 4;
}

const zeroCounts: CacheCounts = Object.freeze({ requests: 0, hits: 0, misses: 0, notCached: 0, fetches: 0, fills: 0 });
const counts = (): CacheCounts => ({ ...zeroCounts });
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
  compile(value, node, seed, scale, remaining, rates) {
    checkCache(value);
    const table = value as CacheTable;
    const cache: NodeCache = {
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
              // A tick must be at most 2% of a tracked freshness interval.
              // Below that resolution use the shared statistical model instead.
              (planned > 0 && rule.policy.ttlMs! < 50 * STEP) ||
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
    const available = now < Math.abs(rule.statisticalUntil);
    const hit = item >= 0 ? now < rule.freshUntil[item] : draw(rule) < (available ? share : 0);
    // Item expiry is already in the statistical formula. Keep availability while
    // traffic is active; idle gaps still cool it. A failed fetch freezes the
    // deadline (negative), so lookups cannot keep a failed origin warm.
    if (item < 0 && rule.statisticalUntil > 0 && available) rule.statisticalUntil = now + rule.policy.ttlMs!;
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
    if (lookup.rule && lookup.item >= 0) lookup.rule.fetching[lookup.item] += size;
  },
  settle(cache, lookup, now, size, ok) {
    if (!lookup.fetching) return;
    lookup.fetching = undefined;
    const rule = lookup.rule;
    if (!rule) return;
    if (lookup.item >= 0) rule.fetching[lookup.item] = Math.max(0, rule.fetching[lookup.item] - size);
    if (!ok || lookup.outcome !== "miss") {
      if (!ok && lookup.item < 0 && lookup.outcome === "miss" && rule.statisticalUntil > 0)
        rule.statisticalUntil = -rule.statisticalUntil;
      return;
    }
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
    // Replies belong to the expiry they observed. A duplicate from an older
    // fetch cycle must not refill again after the first fill has itself expired.
    if (lookup.item >= 0 && lookup.freshUntil === rule.freshUntil[lookup.item] && now >= rule.freshUntil[lookup.item]) {
      rule.freshUntil[lookup.item] = now + rule.policy.ttlMs!;
      rule.counts.fills++;
      cache.counts.fills++;
    }
  },
  read(cache) {
    const c = cache.counts,
      cacheable = c.hits + c.misses;
    return {
      ...c,
      hitRatio: cacheable ? c.hits / cacheable : 0,
      originOffload: c.requests ? 1 - c.fetches / c.requests : 0,
      rules: Object.fromEntries(cache.rules.map((r) => [r.id, { ...r.counts }])),
    };
  },
  details(cache, now) {
    const totals = [0, 0, 0, 0];
    if (cache.window) {
      const second = Math.floor(now / 1000);
      for (let s = Math.max(0, second - 9); s <= cache.window.second; s++)
        for (let i = 0; i < 4; i++) totals[i] += cache.window.buckets[(s % 10) * 4 + i];
    }
    const latency = cache.latency && latencyMetrics(cache.latency);
    return {
      expected: cache.expected,
      ...(cache.window
        ? {
            window: {
              requests: totals[0],
              hits: totals[1],
              misses: totals[2],
              fetches: totals[3],
              seconds: Math.min(10, Math.max(0.01, now / 1000)),
            },
          }
        : {}),
      ...(latency ? { latency: { total: latency, hit: latency.byType.hit, miss: latency.byType.miss } } : {}),
    };
  },
  plan: cachePlan,
  scale: (diagram, simulation, scale) =>
    cacheScale(diagram, simulation, scale, analyzeCapacity(diagram, simulation).cacheDemand ?? {}),
};
installCacheRuntime(cacheRuntime);
