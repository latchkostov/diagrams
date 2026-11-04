import { watchCheckpoints } from "../test/checkpointProbe";
import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { assertCacheInvariants } from "./cacheInvariants";
import type { CacheTable } from "../model/caching";

function fixture() {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 1000, keys: 1, coalesce: true } };
  d.edges[0].props = { networkDelayMs: 0, caller: { deadlineMs: 2000 } };
  d.edges[1].props = { networkDelayMs: 20, caller: { deadlineMs: 1000 } };
  return d;
}

it.each([1, 10, 50])("one real fetch serves every waiter at scale %s, and replays through the herd", (scale) => {
  const d = fixture();
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d, { cache: { "": { rate: 5000, fetchMs: 0 } } });
  e.setScale(scale);
  e.step(1010);
  e.inject("source", 30);
  e.step(10);
  const c = e.snapshot().nodes.cache.cache!;
  expect(c.fetches).toBe(1);
  expect(c.misses).toBe(1);
  expect(c.coalesced).toBe(30 * scale - 1);
  expect(e.snapshot().nodes.cache.cacheDetails!.itemFetches).toBe(1);
  const token = e.checkpoint();
  expect(token.bytes).toBeLessThan(130 * 1024);
  const suffix = () => {
    e.step(2000);
    return e.snapshot();
  };
  const result = suffix();
  expect(result.inSystem).toBe(0);
  expect(result.nodes.cache.cache!.fills).toBe(1);
  expect(result.nodes.cache.processed * scale).toBe(30 * scale);
  for (let i = 0; i < 2; i++) {
    e.restore(token);
    expect(suffix()).toEqual(result);
  }
});

it("a failed fetch fails all waiters, clears ownership, and lets a later request try again", () => {
  const d = fixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { latencyMs: 50, concurrency: 100, jitter: 0, failureRate: 1 };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d, { cache: { "": { rate: 5000, fetchMs: 0 } } });
  e.step(1010);
  e.inject("source", 30);
  e.step(1000);
  expect(e.snapshot().nodes.source.failed).toBe(30);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ fetches: 1, fills: 0 });
  expect(e.snapshot().inSystem).toBe(0);
  e.setNodeProps("origin", { failureRate: 0 });
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ fetches: 2, fills: 1 });
});

it("waiter deadlines don't cancel the cache-owned fetch; its replies are late and still fill", () => {
  const d = fixture();
  d.edges[0].props!.caller = { deadlineMs: 30 };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d, { cache: { "": { rate: 5000, fetchMs: 0 } } });
  e.step(1010);
  e.inject("source", 30);
  e.step(50);
  expect(e.snapshot().edges.input.calls!.timedOut).toBe(30);
  expect(e.snapshot().nodes.cache.cacheDetails!.itemFetches).toBe(1);
  e.step(2000);
  expect(e.snapshot().edges.input.calls!.late).toBe(30);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});

it("C3's oracle rejects a second fetch for an item", () => {
  const c = cacheRuntime.compile({ rules: [], default: { ttlMs: 1000, keys: 1, coalesce: true } }, "edge", 7, 1, {
    value: 1,
  });
  c.rules[0].fetching[0] = 2;
  expect(() => assertCacheInvariants(c)).toThrow("C3");
});

it("waiters occupy no cache threads or origin pool slots", () => {
  const d = fixture();
  d.edges[1].props!.caller = { deadlineMs: 1000, maxInFlight: 2 };
  const e = createEngine({ seed: 7 });
  e.load(d, { cache: { "": { rate: 5000, fetchMs: 0 } } });
  e.step(1010);
  e.inject("source", 30);
  e.step(30);
  const watch = watchCheckpoints();
  e.checkpoint();
  const node = watch.sources[0][0].get("cache")!;
  expect(node.offThreadCalls).toBe(1);
  expect(node.heldCalls).toBe(0);
  expect(node.cache!.flights!.values().next().value!.cacheFlight!.waiters).toHaveLength(30);
  watch.stop();
});

it("misses still doing local work when a fill returns share it instead of fetching again", () => {
  const d = fixture();
  d.nodes[1].props!.latencyMs = 20;
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 60, { spreadMs: 300 });
  e.step(500);
  expect(e.snapshot().nodes.cache.cache!.fetches).toBe(1);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
  expect(e.snapshot().nodes.source.failed).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

it("the cache-owned deadline fails every waiter with 504 without filling", () => {
  const d = fixture();
  d.edges[1].props!.caller = { deadlineMs: 30 };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 30);
  e.step(2000);
  const s = e.snapshot();
  expect(s.nodes.source.failed).toBe(30);
  expect(s.edges.fetch.calls!.timedOut).toBe(1);
  expect(s.edges.input.calls!.failed).toBe(30);
  expect(s.nodes.cache.cache).toMatchObject({ fetches: 1, fills: 0 });
  expect(s.inSystem).toBe(0);
});

it("retries and pool admission belong to the single fetch, never its waiters", () => {
  const d = fixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { latencyMs: 50, concurrency: 100, jitter: 0, failureRate: 1 };
  d.edges[1].props!.caller = {
    deadlineMs: 1000,
    maxInFlight: 1,
    retry: { maxAttempts: 3, backoffMs: 20, strategy: "fixed", retryOn: ["transient"], idempotent: true },
  };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 30);
  for (let i = 0; i < 20; i++) {
    e.step(10);
    expect(e.snapshot().nodes.cache.cacheDetails!.itemFetches).toBeLessThanOrEqual(1);
  }
  e.setNodeProps("origin", { failureRate: 0 });
  e.step(2000);
  const s = e.snapshot();
  expect(s.edges.fetch.calls!.requests).toBe(1);
  expect(s.edges.fetch.calls!.retried).toBeGreaterThan(0);
  expect(s.nodes.cache.cache).toMatchObject({ fetches: 1, fills: 1 });
  expect(s.nodes.source.failed).toBe(0);
  expect(s.inSystem).toBe(0);
});

it("replacing rules during a fetch preserves its old ownership and drains its waiters", () => {
  const d = fixture();
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 30);
  e.step(10);
  e.setNodeProps("cache", { cache: { rules: [], default: { noStore: true } } });
  e.step(2000);
  expect(e.snapshot().nodes.cache.processed).toBe(30);
  expect(e.snapshot().nodes.source.failed).toBe(0);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(0);
  expect(e.snapshot().inSystem).toBe(0);
});

function toggleDuringWork(coalesce: boolean) {
  const d = fixture();
  const table: CacheTable = {
    rules: [
      { id: "hot", match: { types: ["Hot"] }, policy: { ttlMs: 1000, keys: 1, coalesce } },
      { id: "warm", match: { types: ["Warm"] }, policy: { ttlMs: 5000, keys: 1 } },
    ],
  };
  d.nodes[1].props!.cache = table;
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1, { type: "Warm" });
  e.step(200);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
  e.inject("source", 30, { type: "Hot" });
  e.step(10);
  const before = e.snapshot().nodes.cache;
  expect(e.observeCacheItem("cache", "hot", 1)).toMatchObject({
    fetches: coalesce ? 1 : 30,
    waiting: coalesce ? 30 : 0,
  });
  const next = structuredClone(table);
  next.rules[0].policy.coalesce = !coalesce;
  e.setNodeProps("cache", { cache: next });
  expect(e.snapshot().nodes.cache.cache).toEqual(before.cache);
  expect(e.observeCacheItem("cache", "hot", 1)).toMatchObject({
    fetches: coalesce ? 1 : 30,
    waiting: coalesce ? 30 : 0,
  });
  e.inject("source", 1, { type: "Warm" });
  e.inject("source", 30, { type: "Hot" });
  e.step(10);
  expect(e.snapshot().nodes.cache.cache!.hits).toBe(before.cache!.hits + 1);
  expect(e.observeCacheItem("cache", "hot", 1)).toMatchObject({ fetches: 31, waiting: 30 });
  expect(e.snapshot().nodes.cache.cache!.fetches).toBe(32);
  e.step(1000);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ requests: 62, fetches: 32, coalesced: 29, hits: 1, fills: 2 });
  expect(e.snapshot().nodes.source.processed).toBe(62);
  expect(e.snapshot().nodes.source.failed).toBe(0);
  expect(e.observeCacheItem("cache", "hot", 1)).toMatchObject({ fetches: 0, waiting: 0 });
  expect(e.snapshot().inSystem).toBe(0);
}

it("enabling coalescing preserves outstanding independent fetches and warm contents", () => {
  toggleDuringWork(false);
});

it("disabling coalescing preserves the current flight and its waiters", () => {
  toggleDuringWork(true);
});
