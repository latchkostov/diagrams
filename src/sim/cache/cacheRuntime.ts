import { checkCache, CACHE_LIMITS, type CacheTable } from "../../model/caching";
import { compileMatch, matchesRequest, drawStream, streamSeed } from "../routeMatching";
import { acceptsType } from "../topology";
import { itemHitShare, expNeg } from "./cacheMath";
import { popularityTable } from "./popularity";
import { installCacheRuntime, type CacheRuntime } from "./cacheBridge";
import type { CacheCounts, CacheRuleState } from "./cacheState";
import { cacheEnabled } from "../../model/caching";
import { stencilRole } from "../../stencils/roles";
import { cachePlan } from "./planning";

const counts = (): CacheCounts => ({ requests: 0, hits: 0, misses: 0, notCached: 0, fetches: 0, fills: 0 });
function draw(rule: CacheRuleState): number {
  const next = drawStream(rule.stream);
  rule.stream = next.state;
  return next.value;
}
function rate(rule: CacheRuleState, now: number, size: number): number {
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
    return {
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
          const buckets = new Float64Array(10).fill(planned);
          buckets[0] = 0;
          return {
            id: rule.id,
            match: rule.match ? compileMatch(address) : undefined,
            address: Object.keys(address).length > 0,
            types,
            policy: rule.policy,
            popularity,
            stream: streamSeed(seed, node, `cache:${rule.id}`),
            tracked,
            freshUntil,
            fetching: new Float64Array(tracked),
            rate: { buckets, second: 0, planned },
            fetchMs: { samples: new Float64Array(32), cursor: 0, count: 0, sum: 0, planned: fetchMs },
            counts: counts(),
            ...(rates ? {} : { warmSince: 0 }),
          };
        },
      ),
    };
  },
  lookup(cache, type, request, sync, now, size) {
    const rule = cache.rules.find(
      (r) => !r.match || ((!r.address || matchesRequest(r.match, request)) && acceptsType(r.types, type)),
    );
    const add = (key: keyof CacheCounts) => {
      cache.counts[key] += size;
      if (rule) rule.counts[key] += size;
    };
    add("requests");
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
    const hit = item >= 0 ? now < rule.freshUntil[item] : draw(rule) < share;
    add(hit ? "hits" : "misses");
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
    if (lookup.rule) lookup.rule.counts.fetches += size;
    if (lookup.rule && lookup.item >= 0) lookup.rule.fetching[lookup.item] += size;
  },
  settle(cache, lookup, now, size, ok) {
    if (!lookup.fetching) return;
    lookup.fetching = undefined;
    const rule = lookup.rule;
    if (!rule) return;
    if (lookup.item >= 0) rule.fetching[lookup.item] = Math.max(0, rule.fetching[lookup.item] - size);
    if (!ok || lookup.outcome !== "miss") return;
    const mean = rule.fetchMs,
      duration = now - lookup.at;
    if (mean.count === mean.samples.length) mean.sum -= mean.samples[mean.cursor];
    else mean.count++;
    mean.samples[mean.cursor] = duration;
    mean.sum += duration;
    mean.cursor = (mean.cursor + 1) % mean.samples.length;
    if (lookup.item >= 0 && now >= rule.freshUntil[lookup.item]) {
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
  plan: cachePlan,
  scale(diagram, simulation, scale) {
    const rates = cachePlan(diagram, simulation);
    for (const node of diagram.nodes) {
      const table = simulation.setup?.props?.[node.id]?.cache ?? node.props?.cache;
      if (!cacheEnabled(diagram.planning, node.stencil, stencilRole(node.stencil), table)) continue;
      for (const rule of [...table.rules, ...(table.default ? [{ id: "", policy: table.default }] : [])]) {
        if (rule.policy.noStore) continue;
        const hottest = popularityTable(rule.policy.keys, rule.policy.popularity).hottestShare;
        scale = Math.min(
          scale,
          Math.max(1, ((rates[node.id]?.[rule.id]?.rate ?? 0) * hottest * rule.policy.ttlMs!) / 1000 / 50),
        );
      }
    }
    return scale;
  },
};
installCacheRuntime(cacheRuntime);
