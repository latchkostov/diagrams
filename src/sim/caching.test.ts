import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { cacheRuntime } from "./cache/cacheRuntime";
import type { CachePolicy } from "../model/caching";
import retryDrain from "../../tests/fixtures/caching/nested-retry-drain.json";
import type { DiagramFile } from "../model/types";
import { recoveryWorkMs } from "../test/resilienceRecovery";
import { autoScale } from "./scale";
import { expNeg } from "./cache/cacheMath";
import { popularityTable } from "./cache/popularity";

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

it("an empty cache table leaves every engine field and analysis term unchanged", () => {
  const d = cacheFixture();
  delete d.nodes[1].props!.cache;
  const empty = structuredClone(d);
  empty.nodes[1].props!.cache = { rules: [] };
  expect(analyzeCapacity(empty)).toEqual(analyzeCapacity(d));
  const a = createEngine({ seed: 7 }),
    b = createEngine({ seed: 7 });
  a.load(d);
  b.load(empty);
  a.setTraffic(true);
  b.setTraffic(true);
  for (let tick = 0; tick < 100; tick++) {
    a.step(10);
    b.step(10);
    expect(b.snapshot()).toEqual(a.snapshot());
  }
});

it("addressed Messages and POST Requests bypass storing rules in analysis and playback", () => {
  for (const async of [true, false]) {
    const d = cacheFixture();
    d.planning!.requestRoutes = [{ id: "page", address: { method: async ? "GET" : "POST", path: "/page" } }];
    d.nodes[0].props!.trafficMix = { mode: "shares", entries: [{ routeId: "page", share: 1 }] };
    if (async) d.edges[0].kind = "async";
    const a = analyzeCapacity(d);
    expect(a.connections.fetch).toBeCloseTo(200);
    const e = createEngine({ seed: 7 });
    e.load(d);
    e.setTraffic(true);
    e.step(2000);
    expect(e.snapshot().nodes.cache.cache).toMatchObject({ hits: 0, misses: 0, fills: 0 });
    expect(e.snapshot().nodes.cache.cache!.notCached).toBeGreaterThan(0);
  }
});

it("drains the pinned nested-retry case using its finite work bound", () => {
  const d = retryDrain.diagram as DiagramFile;
  const e = createEngine({ seed: retryDrain.seed, scale: retryDrain.scale, maxParticles: 0 });
  e.load(d);
  e.inject("source", 12, { spreadMs: 400 });
  e.step(500);
  e.setFault({ kind: "slow", node: "tier0", factor: 2 });
  e.step(1000);
  e.setFault({ kind: "slow", node: "tier0", factor: 1 });
  e.step(3500);
  e.step(30_000);
  // Timeout does not cancel nested downstream retries. A fixed 30 s drain is insufficient.
  expect(e.metrics().inSystem).toBe(4);
  for (const node of d.nodes) if (node.id.startsWith("tier")) e.setNodeProps(node.id, { failureRate: 0 });
  const steps = Math.ceil(recoveryWorkMs(d, retryDrain.scale, 12) / 1000);
  for (let i = 0; i < steps && e.metrics().inSystem; i++) e.step(1000);
  expect(e.metrics().inSystem).toBe(0);
});

it("popularity compilation and deterministic exponential math stay bounded and accurate", () => {
  const table = popularityTable(1_000_000, "typical");
  expect(table.bands.filter((b) => b.count === 1)).toHaveLength(256);
  expect(table.bands.length).toBeLessThanOrEqual(336);
  expect(table.bands.at(-1)!.cumulative).toBe(1);
  expect(popularityTable(1_000_000, "typical")).toBe(table);
  for (const x of [0, 0.01, 0.1, 1, 10, 100, 745, 1000])
    expect(Math.abs(expNeg(x) - Math.exp(-x))).toBeLessThanOrEqual(1e-12);
});

it("automatic scale keeps the hottest item above the 50-dots-per-TTL tracking threshold", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 10_000;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 5000, keys: 1000 } };
  const simulation = {
    id: "busy",
    title: "Busy",
    traffic: [
      { id: "readers", node: "source", shape: { kind: "constant" as const, ratePerSec: 10_000, durationMs: 1000 } },
    ],
  };
  const scale = autoScale(simulation, d);
  expect(scale).toBeGreaterThan(1);
  const rates = cacheRuntime.plan(d, simulation).cache;
  const cache = cacheRuntime.compile(d.nodes[1].props!.cache, "cache", 7, scale, { value: 4096 }, rates);
  expect(cache.rules[0].tracked).toBeGreaterThan(0);
  const coarse = cacheRuntime.compile(d.nodes[1].props!.cache, "cache", 7, scale * 100, { value: 4096 }, rates);
  expect(coarse.rules[0].tracked).toBe(0);
});
