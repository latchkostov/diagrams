import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { analyzeCapacity } from "./capacity";
import { cacheFetchShare, cacheHitShare } from "./cache/cacheMath";
import type { CacheTable } from "../model/caching";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CacheDerivations } from "../planning/CacheDerivations";
import { createEngine } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { startingCacheRates } from "./cache/cacheBridge";

it("a hot item's fill cycle sends one fetch instead of all requests waiting for it", () => {
  const policy = { ttlMs: 10000, keys: 1, coalesce: true };
  // One leader, 270 arrivals during the origin response, 9000 fresh hits.
  expect(cacheHitShare(policy, 900, 300)).toBeCloseTo(9000 / 9271, 12);
  expect(cacheFetchShare(policy, 900, 300)).toBeCloseTo(1 / 9271, 12);
  expect(cacheFetchShare({ ...policy, coalesce: false }, 900, 300)).toBeCloseTo(271 / 9271, 12);
  expect(cacheFetchShare(policy, 900, 300, 0)).toBeCloseTo(271 / 9271, 12);
  // Statistical items still fetch independently, including when the tracking budget is exhausted.
  expect(cacheFetchShare({ ttlMs: 1000, keys: 2, popularity: "even", coalesce: true }, 200, 50, 1)).toBeCloseTo(
    (1 + 6) / 2 / 106,
    12,
  );
});

it("capacity and Expected use the collapsed fetch share without changing the fresh-hit share", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 900;
  d.edges[1].props = { networkDelayMs: 150 };
  const cache: CacheTable = { rules: [], default: { ttlMs: 10000, keys: 1 } };
  d.nodes[1].props!.cache = cache;
  d.planning!.requestRoutes = [{ id: "page", address: { method: "GET", path: "/page" } }];
  d.nodes[0].props!.trafficMix = { mode: "shares", entries: [{ routeId: "page", share: 1 }] };
  const before = analyzeCapacity(d);
  expect(renderToStaticMarkup(createElement(CacheDerivations, { diagram: d, id: "cache" }))).toContain(
    "If the cache were empty",
  );
  cache.default!.coalesce = true;
  const after = analyzeCapacity(d),
    rule = after.cacheDemand!.cache[""];
  expect(rule.hitRatio).toBe(before.cacheDemand!.cache[""].hitRatio);
  const expected = 900 / (1 + (900 * (10000 + rule.fetchMs)) / 1000);
  expect(after.connections.fetch).toBeCloseTo(expected, 9);
  expect(after.connections.fetch).toBeLessThan(1);
  expect(before.connections.fetch).toBeGreaterThan(10);
  expect(after.routeDemand!.cache.page.servedFromCache).toBeCloseTo(900 - expected, 9);
  const words = renderToStaticMarkup(createElement(CacheDerivations, { diagram: d, id: "cache" }));
  expect(words).toContain("0.097");
  expect(words).not.toContain("If the cache were empty");
});

it("the shared tracking cap leaves later rules' origin demand uncoalesced", () => {
  const d = cacheFixture();
  const cache: CacheTable = { rules: [], default: { ttlMs: 1000, keys: 1, coalesce: true } };
  d.nodes[1].props!.cache = cache;
  // Sixteen quiet rules consume all 4096 tracked slots before the active Default.
  cache.rules = Array.from({ length: 16 }, (_, i) => ({
    id: `quiet-${i}`,
    match: { types: [`Unused-${i}`] },
    policy: { ttlMs: 1000, keys: 256 },
  }));
  const a = analyzeCapacity(d),
    rule = a.cacheDemand!.cache[""];
  expect(rule.fetchShare).toBe(1 - rule.hitRatio);
  expect(a.connections.fetch).toBeCloseTo(200 * (1 - rule.hitRatio), 9);
});

it("nodes without request origins consume no tracking slots, as in playback", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 1000, keys: 1, coalesce: true } };
  d.nodes.unshift(
    ...Array.from({ length: 16 }, (_, i) => ({
      id: `unused-${i}`,
      stencil: "generic.cdn",
      label: "Unused",
      x: 0,
      y: 0,
      props: { cache: { rules: [], default: { ttlMs: 1000, keys: 256 } } },
    })),
  );
  const a = analyzeCapacity(d);
  expect(a.connections.fetch).toBeLessThan(1);
  expect(a.cacheDemand!.cache[""].fetchShare).toBeLessThan(0.01);
});

it.each([1, 7, 17, 42, 99])("coalesced origin demand agrees with a warm run, seed %i", (seed) => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 900;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 5000, keys: 1, coalesce: true } };
  const expected = analyzeCapacity(d).connections.fetch;
  const engine = createEngine({ seed, maxParticles: 0 });
  engine.load(d, startingCacheRates(d));
  engine.setTraffic(true);
  engine.step(20000);
  const before = engine.snapshot().nodes.cache.cache!.fetches;
  engine.step(100000);
  const fetches = engine.snapshot().nodes.cache.cache!.fetches - before;
  // A finite window can intersect one extra fill cycle at either boundary.
  expect(Math.abs(fetches - expected * 100)).toBeLessThanOrEqual(1);
});

it("short-TTL statistical rules do not predict coalescing", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 2000;
  d.planning!.requestRoutes = [{ id: "page", address: { method: "GET", path: "/page" } }];
  d.nodes[0].props!.trafficMix = { mode: "shares", entries: [{ routeId: "page", share: 1 }] };
  const cache: CacheTable = {
    rules: [
      {
        id: "short",
        match: { path: { kind: "exact", value: "/page" } },
        policy: { ttlMs: 100, keys: 1, coalesce: true },
      },
    ],
  };
  d.nodes[1].props!.cache = cache;
  const analysis = analyzeCapacity(d),
    rule = analysis.cacheDemand!.cache.short;
  const runtime = cacheRuntime.compile(cache, "cache", 7, 1, { value: 4096 }, startingCacheRates(d)!.cache);
  expect(runtime.rules[0].tracked).toBe(0);
  expect(rule.fetchShare).toBe(1 - rule.hitRatio);
  expect(analysis.connections.fetch).toBeCloseTo(rule.rate * (1 - rule.hitRatio), 9);
  expect(cacheFetchShare(cache.rules[0].policy, rule.rate, rule.fetchMs)).toBe(1 - rule.hitRatio);
});

it("short-TTL rules leave the shared tracking budget for a coalesced long-TTL rule", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 2000;
  const paths = Array.from({ length: 17 }, (_, i) => `page-${i}`);
  d.planning!.requestRoutes = paths.map((id) => ({ id, address: { method: "GET", path: `/${id}` } }));
  d.nodes[0].props!.trafficMix = {
    mode: "shares",
    entries: paths.map((routeId) => ({ routeId, share: 1 / paths.length })),
  };
  const cache: CacheTable = {
    rules: paths.slice(0, 16).map((id) => ({
      id,
      match: { path: { kind: "exact", value: `/${id}` } },
      policy: { ttlMs: 100, keys: 256, coalesce: true },
    })),
    default: { ttlMs: 1000, keys: 1, coalesce: true },
  };
  d.nodes[1].props!.cache = cache;
  const analysis = analyzeCapacity(d),
    rule = analysis.cacheDemand!.cache[""];
  const runtime = cacheRuntime.compile(cache, "cache", 7, 1, { value: 4096 }, startingCacheRates(d)!.cache);
  expect(runtime.rules.map((r) => r.tracked)).toEqual([...Array<number>(16).fill(0), 1]);
  expect(rule.fetchShare).toBeCloseTo(cacheFetchShare(cache.default!, rule.rate, rule.fetchMs, 1), 12);
  expect(rule.fetchShare).toBeLessThan(1 - rule.hitRatio);
});
