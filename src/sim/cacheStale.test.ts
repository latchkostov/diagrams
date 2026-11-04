import fc from "fast-check";
import { expect, it } from "vitest";
import { cacheRuntime } from "./cache/cacheRuntime";
import { CacheCheckpoint } from "./cache/cacheCheckpoint";
import { propertyRuns } from "../test/fastCheck";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { itemHitShare, cacheFetchShare } from "./cache/cacheMath";
import type { CacheTable } from "../model/caching";

const table = (window = 1000): CacheTable => ({
  rules: [],
  default: { ttlMs: 1000, keys: 1, staleWhileRevalidateMs: window },
});
const compile = (window = 1000) => cacheRuntime.compile(table(window), "cache", 7, 1, { value: 256 });

it("C4: fresh and stale hits respect both deadlines, including absent entries and a zero window", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 15000 }), (window, now) => {
      const cache = compile(window);
      const rule = cache.rules[0];
      rule.freshUntil[0] = 5000;
      const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, now, 1);
      expect(lookup.outcome).toBe(now < 5000 ? "hit" : now < 5000 + window ? "stale" : "miss");
      expect(!!lookup.revalidate).toBe(lookup.outcome === "stale");
      rule.freshUntil[0] = 0;
      expect(cacheRuntime.lookup(cache, "Page", undefined, true, now, 1).outcome).toBe("miss");
    }),
    { numRuns: propertyRuns(100) },
  );
});

it("C6: hard purge empties exactly the selected rules; soft purge preserves copies only within a stale window", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 5000 }), fc.boolean(), fc.boolean(), (now, soft, targeted) => {
      const cache = cacheRuntime.compile(
        {
          rules: [
            { id: "a", match: { types: ["A"] }, policy: { ttlMs: 1000, keys: 1, staleWhileRevalidateMs: 5000 } },
            { id: "b", match: { types: ["B"] }, policy: { ttlMs: 1000, keys: 1 } },
          ],
        },
        "cache",
        7,
        1,
        { value: 256 },
      );
      for (const r of cache.rules) r.freshUntil[0] = now + 100;
      cacheRuntime.purge(cache, now, targeted ? "a" : undefined, soft ? "soft" : "hard");
      expect(cache.rules[0].freshUntil[0]).toBe(soft ? now : 0);
      expect(cache.rules[1].freshUntil[0]).toBe(targeted ? now + 100 : 0);
      expect(cacheRuntime.lookup(cache, "A", undefined, true, now, 1).outcome).toBe(soft ? "stale" : "miss");
    }),
    { numRuns: propertyRuns(100) },
  );
});

it("a failed refresh leaves the original stale deadline unchanged and a later request can retry", () => {
  const cache = compile();
  cache.rules[0].freshUntil[0] = 1000;
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 1100, 1);
  cacheRuntime.start(cache, lookup, 1);
  expect(cacheRuntime.lookup(cache, "Page", undefined, true, 1200, 1).revalidate).toBeUndefined();
  cacheRuntime.settle(cache, lookup, 1300, 1, false);
  expect(cacheRuntime.lookup(cache, "Page", undefined, true, 1400, 1).revalidate).toBe(1);
  expect(cacheRuntime.lookup(cache, "Page", undefined, true, 2000, 1).outcome).toBe("miss");
});

it.each(["hard", "soft"] as const)("a %s purge preserves an in-flight reply's fill and checkpoint state", (mode) => {
  const cache = compile();
  cache.rules[0].freshUntil[0] = 1000;
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 1100, 1);
  cacheRuntime.start(cache, lookup, 1);
  cacheRuntime.purge(cache, 1200, undefined, mode);
  const packed = new CacheCheckpoint(cache.rules[0]);
  expect(packed.restore()).toEqual(cache.rules[0]);
  cacheRuntime.settle(cache, lookup, 1300, 1, true);
  expect(cache.rules[0].freshUntil[0]).toBe(2300);
});

it.each([1, 10, 50])(
  "stale hits reply independently of the one real background fetch at scale %i; purges replay",
  (scale) => {
    const d = cacheFixture();
    d.nodes[1].props!.cache = table(5000);
    d.edges[0].props = { networkDelayMs: 0, caller: { deadlineMs: 50 } };
    d.edges[1].props = { networkDelayMs: 100, caller: { deadlineMs: 1000 } };
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(d, { cache: { "": { rate: 5000, fetchMs: 0 } } });
    e.setScale(scale);
    e.step(1010);
    e.inject("source", 30);
    e.step(30);
    expect(e.snapshot().nodes.cache.cache).toMatchObject({
      hits: 30 * scale,
      staleHits: 30 * scale,
      revalidations: 1,
      fetches: 1,
    });
    expect(e.snapshot().nodes.source.failed).toBe(0);
    const checkpoint = e.checkpoint();
    expect(checkpoint.bytes).toBeLessThan(130 * 1024);
    const suffix = () => {
      e.setFault({ kind: "purge", node: "cache", reason: "deploy" });
      e.step(1000);
      e.inject("source", 1);
      e.step(1000);
      return e.snapshot();
    };
    const result = suffix();
    expect(result.nodes.cache.cache!.fills).toBe(1);
    expect(result.nodes.cache.cache!.fetches).toBe(1);
    expect(result.inSystem).toBe(0);
    expect(result.faults).toBeUndefined();
    e.restore(checkpoint);
    expect(suffix()).toEqual(result);
  },
);

it("stale hits and refreshes use the approved cycle formula", () => {
  const p = { ttlMs: 10000, keys: 1, staleWhileRevalidateMs: 5000 };
  expect(itemHitShare(900, p.ttlMs, 300, p.staleWhileRevalidateMs)).toBe(1);
  expect(cacheFetchShare(p, 900, 300)).toBeCloseTo(1 / 9271, 12);
});
