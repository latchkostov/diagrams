import { expect, it } from "vitest";
import { CacheCheckpoint } from "./cacheCheckpoint";
import { cacheRuntime } from "./cacheRuntime";

it("losslessly restores sparse and dense rings, fractional counters and every mutable rule field", () => {
  const cache = cacheRuntime.compile({ rules: [], default: { ttlMs: 1000, keys: 256 } }, "cache", 7, 1, {
    value: 4096,
  });
  const rule = cache.rules[0];
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 50, 0.25);
  cacheRuntime.start(cache, lookup, 0.25);
  cacheRuntime.settle(cache, lookup, 70, 0.25, true);
  for (const dense of [false, true]) {
    for (const a of [rule.rate.buckets, rule.fetchMs.samples, rule.freshUntil, rule.fetching]) {
      a.fill(0);
      for (let i = 0; i < a.length; i += dense ? 1 : 17) a[i] = i ? i / 3 : -0;
    }
    rule.warmSince = dense ? undefined : 0;
    const expected = structuredClone(rule);
    const checkpoint = new CacheCheckpoint(rule);
    const first = checkpoint.restore();
    expect(first).toEqual(expected);
    for (const a of [first.rate.buckets, first.fetchMs.samples, first.freshUntil, first.fetching]) a.fill(99);
    first.counts.hits++;
    expect(checkpoint.restore()).toEqual(expected);
    expect(rule).toEqual(expected);
  }
});

it("preserves full rings with large integers, fractional samples and signed zero", () => {
  const rule = cacheRuntime.compile({ rules: [], default: { ttlMs: 1000, keys: 1 } }, "cache", 7, 1, {
    value: 4096,
  }).rules[0];
  const samples = Float64Array.from(
    { length: 32 },
    (_, i) => [-0, i / 3, 127, 128, 16384, 2 ** 50 - 1, Number.MAX_SAFE_INTEGER][i % 7],
  );
  rule.fetchMs = { samples, cursor: 17, count: 32, sum: samples.reduce((a, b) => a + b), planned: 42 };
  const checkpoint = new CacheCheckpoint(rule);
  expect(checkpoint.restore()).toEqual(rule);
  rule.fetchMs.samples.fill(0);
  expect(checkpoint.restore().fetchMs.samples).toEqual(
    samples.map((_, i) => [-0, i / 3, 127, 128, 16384, 2 ** 50 - 1, Number.MAX_SAFE_INTEGER][i % 7]),
  );
});
