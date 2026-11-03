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

function routedOrigins() {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 2000;
  d.planning!.requestRoutes = ["fast", "slow"].map((id) => ({
    id,
    address: { method: "GET" as const, path: `/${id}` },
  }));
  d.nodes[0].props!.trafficMix = {
    mode: "shares",
    entries: ["fast", "slow"].map((routeId) => ({ routeId, share: 0.5 })),
  };
  d.nodes[1].props!.cache = {
    rules: ["fast", "slow"].map((id) => ({
      id,
      match: { path: { kind: "exact" as const, value: `/${id}` } },
      policy: { ttlMs: 5000, keys: 1000 },
    })),
  };
  d.nodes[1].props!.routeTable = {
    rules: ["fast", "slow"].map((id) => ({
      id,
      match: { path: { kind: "exact", value: `/${id}` } },
      targets: [{ edgeId: id, weight: 1 }],
    })),
  };
  d.nodes[2].props!.latencyMs = 10;
  d.nodes.push({ ...structuredClone(d.nodes[2]), id: "slow-origin", props: { latencyMs: 1500, jitter: 0 } });
  d.edges[1].id = "fast";
  d.edges.push({ ...structuredClone(d.edges[1]), id: "slow", to: "slow-origin" });
  return d;
}

it.each([1, 7, 17, 42, 99])("A1: routed rules use their own fast and slow origins, seed %i", (seed) => {
  const d = routedOrigins();
  const plan = startingCacheRates(d)!;
  expect(plan.cache.fast.fetchMs).toBe(20);
  expect(plan.cache.slow.fetchMs).toBe(1510);
  const expected = analyzeCapacity(d).cacheDemand!.cache;
  for (const scale of [1, 10]) {
    const e = createEngine({ seed, scale, maxParticles: 0 });
    e.load(d, plan);
    e.setTraffic(true);
    e.step(40_000);
    const before = e.snapshot().nodes.cache.cache!.rules;
    e.step(20_000);
    const after = e.snapshot().nodes.cache.cache!.rules;
    for (const id of ["fast", "slow"]) {
      const requests = after[id].requests - before[id].requests;
      const observed = (after[id].hits - before[id].hits) / requests;
      const error = Math.abs(observed - expected[id].hitRatio);
      const fetchError =
        Math.abs((after[id].fetches - before[id].fetches) / requests - (1 - expected[id].hitRatio)) /
        (1 - expected[id].hitRatio);
      const result = { seed, scale, id, expected: expected[id].hitRatio, observed, error, fetchError };
      console.info("routed agreement", JSON.stringify(result));
      expect(error, JSON.stringify(result)).toBeLessThanOrEqual(scale === 1 ? 0.02 : 0.03);
      if (scale === 1) expect(fetchError, JSON.stringify(result)).toBeLessThanOrEqual(0.05);
    }
  }
});

it("aggregates fetch latency by admitted traffic when a cache rule spans routes", () => {
  const d = routedOrigins();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 5000, keys: 1000 } };
  expect(analyzeCapacity(d).cacheDemand!.cache[""].fetchMs).toBe(765);
});

it("excludes denied origins from a routed rule's fetch latency", () => {
  const d = routedOrigins();
  d.edges[2].props!.deny = true;
  d.nodes[1].props!.routeTable = {
    rules: [],
    default: {
      targets: [
        { edgeId: "fast", weight: 1 },
        { edgeId: "slow", weight: 1 },
      ],
    },
  };
  expect(analyzeCapacity(d).cacheDemand!.cache.fast.fetchMs).toBe(20);
});
