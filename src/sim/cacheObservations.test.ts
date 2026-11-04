import { expect, it, vi } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { ops } from "../test/opCounter";

it("observes either overlapping item directly, even when the other item owns the herd summary", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 1000, keys: 2, popularity: "even" } };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 60);
  e.step(10);
  const one = e.observeCacheItem("cache", "", 1)!;
  const two = e.observeCacheItem("cache", "", 2)!;
  expect(one.fetches).toBeGreaterThan(0);
  expect(two.fetches).toBeGreaterThan(0);
  expect(one.fetches + two.fetches).toBe(60);
  const selected = e.snapshot().nodes.cache.cacheDetails!.herd!;
  const hidden = selected.item === 1 ? two : one;
  expect(e.observeCacheItem("cache", "", hidden.item)).toEqual(hidden);
  for (const item of [0, 3, 1.5, Infinity]) expect(e.observeCacheItem("cache", "", item)).toBeUndefined();
  expect(e.observeCacheItem("missing", "", 1)).toBeUndefined();
  expect(e.observeCacheItem("cache", "missing", 1)).toBeUndefined();
  const token = e.checkpoint();
  e.step(1000);
  expect(e.observeCacheItem("cache", "", hidden.item)).toMatchObject({ fetches: 0, waiting: 0 });
  expect(hidden.fetches).toBeGreaterThan(0);
  e.restore(token);
  expect(e.observeCacheItem("cache", "", hidden.item)).toEqual(hidden);
});

it("ratio expectations use only the bounded window read", () => {
  const e = createEngine();
  e.load(cacheFixture());
  e.inject("source", 60);
  e.step(1000);
  const window = cacheRuntime.window;
  const read = vi.spyOn(cacheRuntime, "window");
  const details = vi.spyOn(cacheRuntime, "details");
  try {
    const s = e.snapshot().nodes.cache.cacheDetails!.window!;
    details.mockClear();
    for (let tick = 0; tick < 100; tick++) {
      expect(e.measure({ node: "cache", field: "hitRatio" })).toBe((100 * s.hits) / (s.hits + s.misses));
      expect(e.measure({ node: "cache", field: "originOffload" })).toBe(100 * (1 - s.fetches / s.requests));
    }
    expect(details.mock.calls.length).toBe(0);
    expect(read).toHaveBeenCalled();
  } finally {
    read.mockRestore();
    details.mockRestore();
  }
  expect(cacheRuntime.window).toBe(window);
});

it("reuses the herd summary across reads without visiting inactive tracked items", () => {
  const cache = cacheRuntime.compile(
    {
      rules: Array.from({ length: 16 }, (_, i) => ({
        id: `rule-${i}`,
        match: { types: [`Type-${i}`] },
        policy: { ttlMs: 1000, keys: 256, popularity: "even" },
      })),
    },
    "cache",
    7,
    1,
    { value: 4096 },
  );
  expect(cache.rules.reduce((total, rule) => total + rule.tracked, 0)).toBe(4096);
  const lookup = cacheRuntime.lookup(cache, "Type-0", undefined, true, 0, 50);
  cacheRuntime.start(cache, lookup, 50);
  const sources = ["src/sim/cache/cacheRuntime.ts"];
  const first = ops(() => cacheRuntime.details(cache, 0), Infinity, sources);
  const repeated = ops(
    () => {
      for (let i = 0; i < 8; i++) {
        expect(cacheRuntime.details(cache, 0).herd?.fetches).toBe(50);
        expect(cacheRuntime.itemFetches(cache)).toBe(50);
      }
    },
    Infinity,
    sources,
  );
  expect(first).toBeGreaterThan(0);
  expect(repeated).toBeLessThan(4096 / 8);
  const observe = vi.spyOn(cacheRuntime, "observeItem");
  try {
    cacheRuntime.details(cache, 0);
    cacheRuntime.itemFetches(cache);
    expect(observe).not.toHaveBeenCalled();
  } finally {
    observe.mockRestore();
  }
  cacheRuntime.settle(cache, lookup, 100, 50, true);
  expect(cacheRuntime.details(cache, 100).herd).toBeUndefined();
  expect(cacheRuntime.itemFetches(cache)).toBe(0);
});
