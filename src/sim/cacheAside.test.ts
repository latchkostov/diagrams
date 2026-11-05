import { expect, it } from "vitest";
import { cacheAsideFixture } from "../lab/cacheAsideFixture";
import { createEngine, randomDraws } from "./engine";
import "./cache/cacheRuntime";
import type { CacheTable } from "../model/caching";
import { analyzeCapacity } from "./capacity";
import { resourceLesson } from "../model/autoscalingLessons";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";

it("looks up before fetching, holds the thread across both phases and writes back implicitly", () => {
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(cacheAsideFixture());
  e.inject("source", 1);
  e.step(20);
  expect(e.snapshot().nodes.database.processed).toBe(0);
  expect(e.snapshot().edges.fetch.calls!.inFlight).toBe(0);
  e.step(40);
  expect(e.snapshot().edges.fetch.calls!.inFlight).toBe(1);
  expect(e.threadUsage("service")!.waiting).toBe(1);
  e.step(200);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ misses: 1, fetches: 1, fills: 1 });
  expect(e.snapshot().nodes.source.processed).toBe(1);
  e.inject("source", 1);
  e.step(200);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ hits: 1, fetches: 1 });
  expect(e.snapshot().nodes.database.processed).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});

it.each([1, 10, 50])("one lease serves overlapping callers and replays at scale %s", (scale) => {
  const d = cacheAsideFixture();
  (d.nodes[2].props!.cache as CacheTable).default!.coalesce = true;
  const e = createEngine({ seed: 7, scale, maxParticles: 0 });
  e.load(d, { cache: { "": { rate: 5000, fetchMs: 110 } } });
  e.step(1010);
  e.inject("source", 20);
  e.step(70);
  expect(e.threadUsage("service")!.waiting).toBeGreaterThan(0);
  const token = e.checkpoint();
  console.info("cache-aside checkpoint", JSON.stringify({ scale, bytes: token.bytes }));
  expect(token.bytes).toBeLessThan(130 * 1024);
  const suffix = () => {
    e.step(3000);
    return e.snapshot();
  };
  const result = suffix();
  expect(result.nodes.database.processed * scale).toBe(1);
  expect(result.nodes.cache.cache!.fills).toBe(1);
  expect(result.nodes.source.failed).toBe(0);
  expect(result.inSystem).toBe(0);
  e.restore(token);
  expect(suffix()).toEqual(result);
});

it("failed or timed-out database calls never fill", () => {
  const d = cacheAsideFixture();
  d.edges[2].props!.caller = { onMiss: "lookup", deadlineMs: 30, wait: "blocking" };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().edges.fetch.calls!.timedOut).toBe(1);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

it("planning includes lookup plus miss-weighted database hold time and demand", () => {
  const d = cacheAsideFixture();
  const a = analyzeCapacity(d);
  const miss = 1 - a.cacheDemand!.cache[""].hitRatio;
  expect(a.cacheDemand!.cache[""].fetchMs).toBe(150);
  expect(a.nodes.database.offered).toBeCloseTo(a.nodes.cache.offered * miss, 8);
  expect(a.nodes.service.waits!.threadHoldMs).toBeCloseTo(10 + 20 + miss * 100, 8);
  d.edges[2].props!.caller = { onMiss: "lookup", wait: "blocking", poolConnections: 1 };
  expect(analyzeCapacity(d).nodes.service.capacity).toBeGreaterThan(10);
});

it("stale cache-aside replies refresh through the database without waiting for it", () => {
  const d = cacheAsideFixture();
  (d.nodes[2].props!.cache as CacheTable).default = {
    ttlMs: 1000,
    keys: 1,
    coalesce: true,
    staleWhileRevalidateMs: 1000,
  };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1);
  e.step(500);
  e.step(700);
  e.inject("source", 1);
  e.step(60);
  expect(e.snapshot().nodes.cache.cache!.staleHits).toBe(1);
  expect(e.snapshot().nodes.source.processed).toBe(2);
  expect(e.snapshot().nodes.database.processed).toBe(1);
  e.step(500);
  expect(e.snapshot().nodes.database.processed).toBe(2);
  expect(e.snapshot().nodes.cache.cache!.revalidations).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});

it("a condition without cache rules is dormant and makes no change to W2 playback or draws", () => {
  const d = cacheAsideFixture();
  delete d.nodes[2].props!.cache;
  const next = createEngine({ seed: 7, maxParticles: 0 });
  const previous = createEngine({ seed: 7, maxParticles: 0 });
  next.load(d);
  previous.load({ ...d, planning: { revision: "p3-w2" } });
  for (const e of [next, previous]) e.setTraffic(true);
  for (let i = 0; i < 200; i++) {
    next.step(10);
    previous.step(10);
    expect(next.snapshot()).toEqual(previous.snapshot());
    expect(randomDraws(next)).toBe(randomDraws(previous));
  }
});

it("planning holds for uncached methods as well as cacheable misses", () => {
  const d = cacheAsideFixture();
  d.planning!.requestRoutes = [
    { id: "read", address: { method: "GET", path: "/products/one" } },
    { id: "write", address: { method: "POST", path: "/orders" } },
  ];
  d.nodes[0].props!.trafficMix = {
    mode: "shares",
    entries: [
      { routeId: "read", share: 0.5 },
      { routeId: "write", share: 0.5 },
    ],
  };
  const a = analyzeCapacity(d);
  const hit = a.cacheDemand!.cache[""].hitRatio;
  expect(a.nodes.database.offered).toBeCloseTo(200 * (1 - hit / 2), 8);
  expect(a.nodes.service.waits!.threadHoldMs).toBeCloseTo(30 + 100 * (1 - hit / 2), 8);
});

it("CPU planning charges non-blocking reply work only for database calls that run", () => {
  const d = cacheAsideFixture();
  d.nodes[1].props!.resources = { ...resourceLesson(), cpuMsPerMessage: 10 };
  for (const edge of d.edges.slice(1))
    edge.props!.caller = { ...(edge.props!.caller as object), wait: "non-blocking", replyMs: 0 };
  const a = analyzeCapacity(d);
  const miss = 1 - a.cacheDemand!.cache[""].hitRatio;
  expect(a.resolved.service.resources!.cpuMsPerMessage).toBeCloseTo(10 + 1 + miss, 8);
});

it("readers whose stale window ends join the existing refresh lease", () => {
  const d = cacheAsideFixture();
  (d.nodes[2].props!.cache as CacheTable).default = {
    ttlMs: 1000,
    keys: 1,
    coalesce: true,
    staleWhileRevalidateMs: 100,
  };
  const e = createEngine({
    seed: 7,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  e.inject("source", 1);
  e.step(1200);
  e.setNodeProps("database", { latencyMs: 1500 });
  e.inject("source", 1);
  e.step(100);
  e.inject("source", 20, { spreadMs: 100 });
  e.step(200);
  expect(e.snapshot().nodes.cache.cacheDetails!.itemFetches).toBe(1);
  expect(e.threadUsage("service")!.waiting).toBe(20);
  expect(e.observeCacheItem("cache", "", 1)?.waiting).toBe(20);
  const token = e.checkpoint();
  const suffix = () => {
    e.step(3000);
    return e.snapshot();
  };
  const result = suffix();
  expect(result.nodes.database.processed).toBe(2);
  expect(result.nodes.cache.cache).toMatchObject({ revalidations: 1, coalesced: 20, fills: 2 });
  expect(result.inSystem).toBe(0);
  e.restore(token);
  expect(suffix()).toEqual(result);
});

for (const failed of [false, true])
  it.each(["read-through", "cache-aside"])(
    `%s and the other access path share one ${failed ? "failed" : "successful"} item lease`,
    (first) => {
      const d = cacheAsideFixture();
      (d.nodes[2].props!.cache as CacheTable).default!.coalesce = true;
      d.nodes.push({ id: "direct", stencil: "client.browser", label: "Direct readers", x: 0, y: -100 });
      d.edges.push(
        { id: "direct-lookup", from: "direct", to: "cache", kind: "sync", props: { travelMs: 10 } },
        { id: "cache-origin", from: "cache", to: "database", kind: "sync", props: { travelMs: 10 } },
      );
      if (failed) {
        d.nodes[3].stencil = "generic.service";
        d.nodes[3].props = { latencyMs: 100, jitter: 0, failureRate: 1, concurrency: 100 };
      }
      const e = createEngine({
        seed: 7,
        maxParticles: 0,
        verifyLedger: assertLedgerInvariants,
        verifyOutcomes: assertOutcomeInvariants,
      });
      e.load(d, { cache: { "": { rate: 5000, fetchMs: 110 } } });
      e.step(1010);
      e.inject(first === "read-through" ? "direct" : "source", 10);
      e.step(70);
      e.inject(first === "read-through" ? "source" : "direct", 10);
      e.step(40);
      expect(e.observeCacheItem("cache", "", 1)?.fetches).toBe(1);
      const token = e.checkpoint();
      const suffix = () => {
        e.step(2000);
        return e.snapshot();
      };
      const result = suffix();
      const completed = failed ? "failed" : "processed";
      expect(result.nodes.database[completed]).toBe(1);
      expect(result.nodes.source[completed]).toBe(10);
      expect(result.nodes.direct[completed]).toBe(10);
      expect(result.nodes.cache.cache).toMatchObject({ misses: 1, coalesced: 19, fills: failed ? 0 : 1 });
      expect(result.inSystem).toBe(0);
      e.restore(token);
      expect(suffix()).toEqual(result);
    },
  );

it.each([
  ["generic.cache", false],
  ["generic.cdn", false],
  ["generic.cdn", true],
] as const)("mixed access through %s (routed: %s) plans one origin demand and a local lookup", (stencil, routed) => {
  const d = cacheAsideFixture();
  d.nodes[2].stencil = stencil;
  d.nodes.push({
    id: "direct",
    stencil: "client.browser",
    label: "Direct readers",
    x: 0,
    y: -100,
    props: { ratePerSec: 100 },
  });
  d.edges.push(
    { id: "direct-lookup", from: "direct", to: "cache", kind: "sync" },
    { id: "cache-origin", from: "cache", to: "database", kind: "sync" },
  );
  if (routed) {
    d.planning!.requestRoutes = [{ id: "read", address: { method: "GET", path: "/products/one" } }];
    for (const node of [d.nodes[0], d.nodes.at(-1)!])
      node.props!.trafficMix = { mode: "shares", entries: [{ routeId: "read", share: 1 }] };
    d.nodes[2].props!.routeTable = { rules: [], default: { targets: [{ edgeId: "cache-origin", weight: 1 }] } };
  }
  const a = analyzeCapacity(d);
  const cache = a.cacheDemand!.cache[""];
  const miss = 1 - cache.hitRatio;
  expect(cache.rate).toBe(300);
  expect(cache.fetchMs).toBeCloseTo((200 * 150 + 100 * 110) / 300, 8);
  expect(a.nodes.database.offered).toBeCloseTo(cache.rate * miss, 8);
  expect(a.nodes.service.waits!.threadHoldMs).toBeCloseTo(30 + miss * 100, 8);
});
