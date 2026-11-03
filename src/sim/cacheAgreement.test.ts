import fc from "fast-check";
import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { propertyRuns } from "../test/fastCheck";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { startingCacheRates } from "./cache/cacheBridge";

export function agreement(seed: number, scale: number, keys = 1000, ttlMs = 5000) {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 1000;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs, keys, popularity: "typical" } };
  const expected = analyzeCapacity(d).cacheDemand!.cache[""].hitRatio;
  const e = createEngine({ seed, maxParticles: 0 });
  e.load(d, startingCacheRates(d));
  e.setScale(scale);
  e.setTraffic(true);
  e.step(40_000);
  const before = e.snapshot().nodes.cache.cache!;
  e.step(20_000);
  const after = e.snapshot().nodes.cache.cache!;
  const requests = after.requests - before.requests;
  const observed = (after.hits - before.hits) / requests;
  const fetchShare = (after.fetches - before.fetches) / requests;
  return {
    seed,
    scale,
    expected,
    observed,
    error: Math.abs(expected - observed),
    fetchError: Math.abs(fetchShare - (1 - expected)) / (1 - expected),
  };
}

it.each([1, 7, 17, 42, 99])("A1: analysis and Live agree over a steady 20 s window, seed %i", (seed) => {
  for (const scale of [1, 10]) {
    const result = agreement(seed, scale);
    expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(scale === 1 ? 0.02 : 0.03);
    if (scale === 1) expect(result.fetchError, JSON.stringify(result)).toBeLessThanOrEqual(0.05);
  }
});

// Keep Nightly's full case count without putting every simulation under one test-runner timeout.
it.each([0, 1, 2, 3, 4])("A1: random rule sizes and TTLs preserve steady-state agreement (batch %i)", (batch) => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1000, max: 20_000 }),
      fc.integer({ min: 5000, max: 30_000 }),
      fc.integer(),
      (keys, ttl, seed) => {
        const result = agreement(seed, 1, keys, ttl);
        expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(0.02);
      },
    ),
    {
      numRuns: propertyRuns(1),
      ...(fc.readConfigureGlobal().seed === undefined ? {} : { seed: (fc.readConfigureGlobal().seed! + batch) | 0 }),
    },
  );
});
