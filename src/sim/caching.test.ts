import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { cacheRuntime } from "./cache/cacheRuntime";
import type { CachePolicy } from "../model/caching";

it.each(["generic.cdn", "generic.cache"])("%s answers hits and forwards misses", (stencil) => {
  const d = cacheFixture();
  d.nodes[1].stencil = stencil;
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.setTraffic(true);
  e.step(10_000);
  const s = e.snapshot();
  const c = s.nodes.cache.cache!;
  expect(c.requests).toBe(c.hits + c.misses + c.notCached);
  expect(c.hits).toBeGreaterThan(100);
  expect(c.misses).toBeGreaterThan(10);
  expect(s.nodes.origin.processed).toBeGreaterThan(10);
  expect(s.nodes.origin.processed).toBeLessThan(s.nodes.cache.processed / 2);
  expect(c.fetches).toBe(c.misses);
  e.setTraffic(false);
  e.step(2000);
  expect(e.snapshot().inSystem).toBe(0);
  expect(e.snapshot().nodes.origin.processed).toBe(e.snapshot().nodes.cache.cache!.fetches);
});

it("restores typed cache state and work aliases, replaying every suffix frame", () => {
  const e = createEngine({ seed: 17 });
  e.load(cacheFixture());
  e.setTraffic(true);
  e.step(2500);
  const token = e.checkpoint();
  const suffix = () =>
    Array.from({ length: 100 }, () => {
      e.step(10);
      return e.snapshot();
    });
  const expected = suffix();
  for (let repeat = 0; repeat < 2; repeat++) {
    e.restore(token);
    expect(suffix()).toEqual(expected);
  }
});

it("only the first successful reply fills; failed and no-store fetches never fill", () => {
  const compile = (policy: CachePolicy) =>
    cacheRuntime.compile({ rules: [], default: policy }, "edge", 7, 1, { value: 4096 });
  const c = compile({ ttlMs: 1000, keys: 1 });
  const a = cacheRuntime.lookup(c, "Page", undefined, true, 0, 1);
  const b = cacheRuntime.lookup(c, "Page", undefined, true, 0, 1);
  cacheRuntime.start(c, a, 1);
  cacheRuntime.start(c, b, 1);
  cacheRuntime.settle(c, a, 100, 1, true);
  cacheRuntime.settle(c, b, 200, 1, true);
  expect(c.rules[0].freshUntil[0]).toBe(1100);
  expect(c.counts.fills).toBe(1);
  expect(cacheRuntime.lookup(c, "Page", undefined, true, 1099, 1).outcome).toBe("hit");
  const expired = cacheRuntime.lookup(c, "Page", undefined, true, 1100, 1);
  expect(expired.outcome).toBe("miss");
  cacheRuntime.start(c, expired, 1);
  cacheRuntime.settle(c, expired, 1200, 1, false);
  expect(c.rules[0].freshUntil[0]).toBe(1100);
  const n = compile({ noStore: true });
  const pass = cacheRuntime.lookup(n, "Page", undefined, true, 0, 1);
  cacheRuntime.start(n, pass, 1);
  cacheRuntime.settle(n, pass, 100, 1, true);
  expect(n.counts).toMatchObject({ hits: 0, misses: 0, fills: 0, notCached: 1 });
});

it("analysis reduces origin demand by the derived hit share", () => {
  const a = analyzeCapacity(cacheFixture());
  const rule = a.cacheDemand!.cache[""];
  expect(rule.rate).toBeCloseTo(200);
  expect(rule.hitRatio).toBeGreaterThan(0.8);
  expect(a.connections.fetch).toBeCloseTo(200 * (1 - rule.hitRatio), 3);
});
