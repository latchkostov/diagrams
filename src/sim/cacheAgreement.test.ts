import fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { propertyRuns } from "../test/fastCheck";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { analyzePlanningCapacity, planningSimulation } from "./capacityPlanning";
import { explanationSimulation } from "../planning/explanation";
import type { CacheTable, Popularity } from "../model/caching";
import { configuredPlanning } from "../planning/cache";
import { startingCacheRates } from "./cache/cacheBridge";
import { autoScale } from "./scale";

const sweep: { mode: number | "auto"; scale: number; before: number; after: number }[] = [];
afterAll(() =>
  console.info(
    "agreement sweep maxima",
    JSON.stringify(
      [1, 10, "auto"].map((mode) => ({
        mode,
        cases: sweep.filter((r) => r.mode === mode).length,
        before: Math.max(...sweep.filter((r) => r.mode === mode).map((r) => r.before)),
        after: Math.max(...sweep.filter((r) => r.mode === mode).map((r) => r.after)),
      })),
    ),
  ),
);

function agreementDiagram(keys: number, ttlMs: number, popularity: Popularity, rate: number, fetchMs: number) {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = rate;
  d.nodes[2].props!.latencyMs = fetchMs - 10;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs, keys, popularity } };
  return d;
}

export function agreement(
  seed: number,
  scale: number | "auto",
  keys = 1000,
  ttlMs = 5000,
  popularity: Popularity = "typical",
  rate = 1000,
  fetchMs = 60,
  coalesce = false,
  staleWhileRevalidateMs = 0,
) {
  const d = agreementDiagram(keys, ttlMs, popularity, rate, fetchMs);
  if (coalesce) (d.nodes[1].props!.cache as CacheTable).default!.coalesce = true;
  if (staleWhileRevalidateMs)
    (d.nodes[1].props!.cache as CacheTable).default!.staleWhileRevalidateMs = staleWhileRevalidateMs;
  if (scale === "auto") scale = autoScale(explanationSimulation(d), d);
  const legacyExpected = analyzeCapacity(d, planningSimulation(d, explanationSimulation(d))).cacheDemand!.cache[""]
    .hitRatio;
  const expected = analyzePlanningCapacity(d, explanationSimulation(d)).cacheDemand!.cache[""].hitRatio;
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
    keys,
    ttlMs,
    popularity,
    rate,
    fetchMs,
    requests,
    expected,
    legacyExpected,
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

it.each([1, 7, 17, 42, 99])("A1: reviewer's 200/s, 20 even items, 1 s TTL and 60 ms fetch agree, seed %i", (seed) => {
  const d = cacheFixture();
  const plan = configuredPlanning(d)!;
  expect(plan.analysis.cacheDemand!.cache[""].fetchMs).toBe(60);
  expect(plan.cacheExplanation("cache")![0].hitRatio).toBeCloseTo(10 / 11.6, 12);
  expect(plan.analysis.nodes.origin.capacity).toBe(Infinity);
  const result = agreement(seed, 1, 20, 1000, "even", 200, 60);
  console.info("review agreement", JSON.stringify(result));
  expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(0.02);
});

it.each([1, 20])("A1: fetches longer than TTL retain one fill per expiry (%i items)", (keys) => {
  const runs = [0, 1, 2, 3, 4].map((seed) => agreement(seed, 1, keys, 1000, "even", 200, 1510));
  const observed = runs.reduce((sum, r) => sum + r.observed, 0) / runs.length;
  console.info("long fetch agreement", JSON.stringify({ keys, expected: runs[0].expected, observed }));
  expect(Math.abs(observed - runs[0].expected), JSON.stringify({ runs, observed })).toBeLessThanOrEqual(0.02);
});

it.each([1, 10])("A1: short freshness intervals use the formula below tick resolution (scale %i)", (scale) => {
  const runs = [0, 1, 2, 3, 4].map((seed) => agreement(seed, scale, 20, 100, "even", 200, 10));
  const observed = runs.reduce((sum, r) => sum + r.observed, 0) / runs.length;
  expect(Math.abs(observed - runs[0].expected), JSON.stringify({ runs, observed })).toBeLessThanOrEqual(
    scale === 1 ? 0.02 : 0.03,
  );
});

it.each([1, 7, 17, 42, 99])(
  "one-item agreement at scale 10 and at the automatically selected scale, seed %i",
  (seed) => {
    for (const scale of [10, "auto"] as const) {
      const result = agreement(seed, scale, 1, 100, "even", 200, 10);
      console.info("one-item agreement", JSON.stringify(result));
      expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(0.03);
    }
  },
);

it.each(Array.from({ length: 20 }, (_, i) => i + 1))(
  "automatic short-TTL scale preserves Expected/Live agreement (%i items)",
  (keys) => {
    for (const rate of [200, 2000]) {
      const runs = [1, 7, 17, 42, 99].map((seed) => agreement(seed, "auto", keys, 100, "even", rate, 10));
      const observed = runs.reduce((sum, r) => sum + r.observed, 0) / runs.length;
      const error = Math.abs(observed - runs[0].expected);
      console.info(
        "automatic agreement",
        JSON.stringify({ ...runs[0], observed, error, dotsPerSec: rate / runs[0].scale }),
      );
      expect(error, JSON.stringify({ runs, observed, error })).toBeLessThanOrEqual(runs[0].scale === 1 ? 0.02 : 0.03);
    }
  },
);

it.fails("A1 known sampling gap: one tracked item with a 30 s TTL in a 20 s window (scale 1, seeds 16–20)", () => {
  const runs = [16, 17, 18, 19, 20].map((seed) => agreement(seed, 1, 1, 30_000, "even", 200, 1510));
  const observed = runs.reduce((sum, r) => sum + r.observed, 0) / runs.length;
  console.info(
    "long-TTL sampling gap",
    JSON.stringify({ runs, observed, error: Math.abs(observed - runs[0].expected) }),
  );
  expect(Math.abs(observed - runs[0].expected)).toBeLessThanOrEqual(0.02);
});

it.each([10, "auto"] as const)("A1: the pinned long-TTL window at scale %s stays within 3 points", (scale) => {
  const runs = [16, 17, 18, 19, 20].map((seed) => agreement(seed, scale, 1, 30_000, "even", 200, 1510));
  const observed = runs.reduce((sum, r) => sum + r.observed, 0) / runs.length;
  console.info(
    "long-TTL sampled window",
    JSON.stringify({ runs, observed, error: Math.abs(observed - runs[0].expected) }),
  );
  expect(Math.abs(observed - runs[0].expected)).toBeLessThanOrEqual(0.03);
});

it.fails.each([1, 10, "auto"] as const)(
  "A1 known sampling gap: a 20 s window can miss every tracked 30 s expiry (scale %s, seed 18)",
  (scale) => {
    const result = agreement(18, scale, 1, 30_000, "even", 200, 1510);
    expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(result.scale === 1 ? 0.02 : 0.03);
  },
);

it.each([0, 1, 2, 3, 4])("A1: stale serving agrees for tracked items and statistical tails (batch %i)", (batch) => {
  fc.assert(
    fc.property(fc.integer(), fc.constantFrom(1, 10), fc.constantFrom(1, 1000), (seed, scale, keys) => {
      const result = agreement(seed, scale, keys, 1000, "typical", 1000, 60, true, 5000);
      expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(scale === 1 ? 0.02 : 0.03);
    }),
    {
      numRuns: propertyRuns(1),
      ...(fc.readConfigureGlobal().seed === undefined ? {} : { seed: (fc.readConfigureGlobal().seed! + batch) | 0 }),
    },
  );
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

// Generate the same seeded case corpus for every scale. Run each observation
// separately, then assert the original aggregate bound, without changing the
// 40 s warm-up, 20 s measurement, minimum seeds or 10,000-dot sample floor.
for (const batch of [0, 1, 2, 3, 4]) {
  const parameters = {
    numRuns: propertyRuns(1),
    ...(fc.readConfigureGlobal().seed === undefined ? {} : { seed: (fc.readConfigureGlobal().seed! + batch) | 0 }),
  };
  const general = fc.sample(
    fc.tuple(
      fc.constantFrom(20, 256, 1000, 20_000),
      fc.constantFrom(100, 1000, 5000, 30_000),
      fc.constantFrom<Popularity>("even", "gentle", "typical", "steep"),
      fc.constantFrom(200, 1000, 2000),
      fc.constantFrom(10, 60, 250, 1510),
      fc.integer(),
    ),
    parameters,
  );
  const shortTtl = fc.sample(
    fc.tuple(
      fc.integer({ min: 1, max: 20 }),
      fc.constantFrom(100, 200, 400),
      fc.constantFrom<Popularity>("even", "gentle", "typical", "steep"),
      fc.constantFrom(200, 1000, 2000),
      fc.constantFrom(10, 60, 250, 1510),
      fc.integer(),
    ),
    parameters,
  );
  const cases = [
    ...general.map((input) => ({ kind: "general", input, modes: [1, 10, "auto"] as const })),
    ...shortTtl.map((input) => ({ kind: "short TTL", input, modes: ["auto"] as const })),
  ];
  for (const [
    run,
    {
      kind,
      input: [keys, ttl, popularity, rate, fetchMs, seed],
      modes,
    },
  ] of cases.entries()) {
    for (const mode of modes) {
      const d = agreementDiagram(keys, ttl, popularity, rate, fetchMs);
      const scale = mode === "auto" ? autoScale(explanationSimulation(d), d) : mode;
      const seeds = Math.max(5, Math.ceil(10_000 / ((20 * rate) / scale)));
      const runs: ReturnType<typeof agreement>[] = [];
      const label = `${kind}, batch ${batch}, case ${run}, scale ${mode}`;
      it.each(Array.from({ length: seeds }, (_, n) => (seed + n) | 0))(
        `A1: item count, popularity, TTL, fetch time and rate sweep observation (${label}, seed %i)`,
        (sampleSeed) => {
          const result = agreement(sampleSeed, scale, keys, ttl, popularity, rate, fetchMs);
          expect(Number.isFinite(result.observed), JSON.stringify(result)).toBe(true);
          runs.push(result);
        },
      );
      it(`A1: item count, popularity, TTL, fetch time and rate sweep agreement (${label})`, () => {
        expect(runs).toHaveLength(seeds);
        const requests = runs.reduce((sum, r) => sum + r.requests, 0);
        const observed = runs.reduce((sum, r) => sum + r.observed * r.requests, 0) / requests;
        const error = Math.abs(observed - runs[0].expected);
        sweep.push({ mode, scale, before: Math.abs(observed - runs[0].legacyExpected), after: error });
        expect(error, JSON.stringify({ runs, observed, error })).toBeLessThanOrEqual(scale === 1 ? 0.02 : 0.03);
      });
    }
  }
}

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

it.each([1, 7, 17, 42, 99])("coalesced fills preserve Expected/Live fresh-hit agreement, seed %i", (seed) => {
  for (const scale of [1, 10]) {
    for (const fetchMs of [60, 1510]) {
      const result = agreement(seed, scale, 1, 1000, "even", 2000, fetchMs, true);
      expect(result.error, JSON.stringify(result)).toBeLessThanOrEqual(scale === 1 ? 0.02 : 0.03);
    }
  }
});
