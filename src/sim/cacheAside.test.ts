import { expect, it } from "vitest";
import { cacheAsideFixture } from "../lab/cacheAsideFixture";
import { watchCheckpoints } from "../test/checkpointProbe";
import { createEngine, randomDraws } from "./engine";
import "./cache/cacheRuntime";
import type { CacheTable } from "../model/caching";
import { analyzeCapacity } from "./capacity";
import { resourceLesson } from "../model/autoscalingLessons";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";
import { opGrowth } from "../test/opCounter";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

function renamedLookupFixture() {
  const d = cacheAsideFixture();
  d.planning!.requestRoutes = [
    { id: "caller", address: { method: "GET", path: "/products/one" } },
    { id: "lookup", address: { method: "GET", path: "/cache/one" } },
  ];
  d.nodes[1].props!.emits = "Read";
  d.nodes[2].props!.emits = "CacheOutput";
  (d.nodes[2].props!.cache as CacheTable).default = {
    ttlMs: 1000,
    keys: 1,
    coalesce: true,
    staleWhileRevalidateMs: 1000,
  };
  d.edges[0].props!.requestRouteId = "caller";
  Object.assign(d.edges[1].props!, { emits: "CacheRead", requestRouteId: "lookup" });
  d.nodes.push({ ...d.nodes[3], id: "required-database", props: { latencyMs: 300, jitter: 0 } });
  d.edges.push({
    ...d.edges[2],
    id: "required-fetch",
    to: "required-database",
    props: { ...d.edges[2].props, filter: ["Read"] },
  });
  return d;
}

it.each([false, true])("renamed stale lookup refresh dispatches all caller origins (required down: %s)", (down) => {
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(renamedLookupFixture());
  e.inject("source", 1);
  e.step(1500);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
  if (down) e.setNodeStatus("required-database", "down");
  e.inject("source", 1);
  e.step(60);
  expect(e.snapshot().nodes.cache.cache!.staleHits).toBe(1);
  expect(e.snapshot().edges.fetch.delivered).toBe(2);
  expect(e.snapshot().edges["required-fetch"].delivered).toBe(2);
  e.step(500);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(down ? 1 : 2);
  expect(e.snapshot().inSystem).toBe(0);
});

it("renamed stale lookup refresh sends the cold miss message type and request address", () => {
  const watch = watchCheckpoints(2);
  try {
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(renamedLookupFixture());
    const dispatched = () => {
      e.checkpoint();
      const nodes = watch.sources.at(-1)![0];
      return ["database", "required-database"].map((id) => {
        const message = nodes.get(id)!.working[0]?.message;
        return {
          type: message?.type,
          request: message?.request && { method: message.request.method, path: message.request.path },
        };
      });
    };
    e.inject("source", 1);
    e.step(60);
    const cold = dispatched();
    expect(cold).toEqual([
      { type: "Read", request: { method: "GET", path: "/products/one" } },
      { type: "Read", request: { method: "GET", path: "/products/one" } },
    ]);
    e.step(1440);
    e.inject("source", 1);
    e.step(60);
    expect(dispatched()).toEqual(cold);
  } finally {
    watch.stop();
  }
});

it("renamed stale lookup replays caller selection before and during refresh from checkpoints", () => {
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(renamedLookupFixture());
  e.inject("source", 1);
  e.step(1500);
  e.setNodeStatus("required-database", "down");
  e.inject("source", 1);
  e.step(30);
  const lookup = e.checkpoint();
  e.step(30);
  const refresh = e.checkpoint();
  e.step(500);
  const result = e.snapshot();
  expect(result.edges["required-fetch"].delivered).toBe(2);
  expect(result.nodes.cache.cache!.fills).toBe(1);
  expect(result.inSystem).toBe(0);
  e.restore(lookup);
  e.step(530);
  expect(e.snapshot()).toEqual(result);
  e.restore(refresh);
  e.step(500);
  expect(e.snapshot()).toEqual(result);
});

it("an ended caller skips renamed stale refresh deterministically after restore", () => {
  const d = renamedLookupFixture();
  d.edges[1].props!.caller = { wait: "blocking", deadlineMs: 100 };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1);
  e.step(1500);
  expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
  e.setNodeProps("cache", { latencyMs: 200 });
  e.inject("source", 1);
  e.step(150);
  const token = e.checkpoint();
  e.step(500);
  const result = e.snapshot();
  expect(result.nodes.cache.cache!.staleHits).toBe(1);
  expect(result.edges.fetch.delivered).toBe(1);
  expect(result.edges["required-fetch"].delivered).toBe(1);
  expect(result.nodes.cache.cache!.fills).toBe(1);
  expect(result.inSystem).toBe(0);
  e.restore(token);
  e.step(500);
  expect(e.snapshot()).toEqual(result);
});

it("cancelling coalesced waiters is linear while another service owns the lease", () => {
  const prepare = (count: number) => {
    const d = cacheAsideFixture();
    (d.nodes[2].props!.cache as CacheTable).default!.coalesce = true;
    d.nodes[3].props!.latencyMs = 10_000;
    d.nodes[1].props!.concurrency = count;
    d.nodes.push({ ...d.nodes[1], id: "waiting-service" });
    d.edges.push(
      { ...d.edges[1], id: "waiting-lookup", from: "waiting-service" },
      { ...d.edges[2], id: "waiting-fetch", from: "waiting-service", props: { caller: { onMiss: "waiting-lookup" } } },
    );
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(d);
    e.inject("service", 1);
    e.step(100);
    e.inject("waiting-service", count);
    e.step(100);
    expect(e.observeCacheItem("cache", "", 1)?.waiting).toBe(count);
    return () => {
      e.setNodeStatus("waiting-service", "down");
      expect(e.observeCacheItem("cache", "", 1)?.waiting).toBe(0);
      expect(e.snapshot().edges.fetch.calls!.inFlight).toBe(1);
    };
  };
  const small = prepare(64),
    large = prepare(64 * GROWTH_FACTOR);
  expect(opGrowth(small, large, LINEAR_LIMIT, ["src/sim/cache/cacheAside.ts"])).toBeLessThan(LINEAR_LIMIT);
});

it.each(["none", "database", "slow-database"])(
  "stale refresh joins every conditional origin before filling (failed: %s)",
  (failed) => {
    const d = cacheAsideFixture();
    (d.nodes[2].props!.cache as CacheTable).default = {
      ttlMs: 1000,
      keys: 1,
      coalesce: true,
      staleWhileRevalidateMs: 1000,
    };
    d.nodes.push({ ...d.nodes[3], id: "slow-database", props: { latencyMs: 300, jitter: 0 } });
    d.edges.push({ ...d.edges[2], id: "slow-fetch", to: "slow-database" });
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(d);
    e.inject("source", 1);
    e.step(1500);
    expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
    if (failed !== "none") e.setNodeStatus(failed, "down");
    e.inject("source", 1);
    e.step(60);
    expect(e.snapshot().nodes.cache.cache!.staleHits).toBe(1);
    expect(e.snapshot().nodes.source.processed).toBe(2);
    expect(e.snapshot().edges.fetch.delivered).toBe(2);
    expect(e.snapshot().edges["slow-fetch"].delivered).toBe(2);
    e.step(150);
    expect(e.snapshot().nodes.cache.cache!.fills).toBe(1);
    const token = e.checkpoint();
    e.step(500);
    const result = e.snapshot();
    expect(result.nodes.cache.cache!.fills).toBe(failed === "none" ? 2 : 1);
    expect(result.inSystem).toBe(0);
    e.restore(token);
    e.step(500);
    expect(e.snapshot()).toEqual(result);
  },
);

it.each(["blocking", "non-blocking"] as const)(
  "coalesced fetches consume pool capacity once, with %s database calls",
  (wait) => {
    const d = cacheAsideFixture();
    (d.nodes[2].props!.cache as CacheTable).default!.coalesce = true;
    d.edges[2].props!.caller = { onMiss: "lookup", wait, poolConnections: 1 };
    const a = analyzeCapacity(d);
    const fetchShare = a.cacheDemand!.cache[""].fetchShare!;
    expect(a.nodes.service.waits!.poolCeiling).toBeCloseTo(1000 / (100 * fetchShare), 6);
    const miss = 1 - a.cacheDemand!.cache[""].hitRatio;
    expect(fetchShare).toBeLessThan(miss / 2);
    if (wait === "blocking") expect(a.nodes.service.waits!.threadHoldMs).toBeCloseTo(10 + 20 + 100 * miss, 8);
  },
);

it.each([0, 0.5, 1])("database demand follows the lookup's %s traffic share as well as its misses", (share) => {
  const d = cacheAsideFixture();
  d.edges[1].props!.share = share;
  d.edges[2].props!.share = 0.5;
  const a = analyzeCapacity(d);
  const miss = 1 - (a.cacheDemand?.cache?.[""]?.hitRatio ?? 0);
  expect(a.nodes.database.offered).toBeCloseTo(a.nodes.cache.offered * miss * 0.5, 8);
});

it("a sampled lookup invokes the database only for requests that actually looked up the cache", () => {
  const d = cacheAsideFixture();
  d.edges[1].props!.share = 0.5;
  d.nodes[2].props!.cache = { rules: [], default: { noStore: true } };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 100, { spreadMs: 1000 });
  e.step(3000);
  const s = e.snapshot();
  expect(s.nodes.cache.processed).toBeGreaterThan(0);
  expect(s.nodes.cache.processed).toBeLessThan(100);
  expect(s.nodes.database.processed).toBe(s.nodes.cache.processed);
  expect(s.nodes.source.processed).toBe(100);
  expect(s.inSystem).toBe(0);
});

it.each([false, true])("one lookup joins every database branch before filling (coalesce %s)", (coalesce) => {
  const d = cacheAsideFixture();
  (d.nodes[2].props!.cache as CacheTable).default!.coalesce = coalesce;
  d.nodes.push({ ...d.nodes[3], id: "slow-database", props: { latencyMs: 300, jitter: 0 } });
  d.edges.push({ ...d.edges[2], id: "slow-fetch", to: "slow-database" });
  const e = createEngine({
    seed: 7,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  e.inject("source", 20);
  e.step(250);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ fetches: coalesce ? 1 : 20, fills: 0 });
  expect(e.snapshot().nodes.source.processed).toBe(0);
  const token = e.checkpoint();
  e.step(1000);
  const result = e.snapshot();
  expect(result.nodes.cache.cache).toMatchObject({
    misses: coalesce ? 1 : 20,
    fetches: coalesce ? 1 : 20,
    fills: 1,
  });
  expect(result.nodes.cache.cache!.coalesced ?? 0).toBe(coalesce ? 19 : 0);
  expect(result.nodes.database.processed).toBe(coalesce ? 1 : 20);
  expect(result.nodes["slow-database"].processed).toBe(coalesce ? 1 : 20);
  expect(result.nodes.source.processed).toBe(20);
  expect(result.inSystem).toBe(0);
  e.restore(token);
  e.step(1000);
  expect(e.snapshot()).toEqual(result);
});

it("an unrelated first-phase reply cannot dispatch the database before its cache lookup", () => {
  const d = cacheAsideFixture();
  d.nodes[2].props!.latencyMs = 100;
  d.nodes.push({ ...d.nodes[3], id: "fast", props: { latencyMs: 1, jitter: 0 } });
  d.edges.push({ id: "unrelated", from: "service", to: "fast", kind: "sync", props: { travelMs: 1 } });
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1);
  e.step(60);
  expect(e.snapshot().nodes.fast.processed).toBe(1);
  expect(e.snapshot().edges.fetch.calls!.inFlight).toBe(0);
  e.step(300);
  expect(e.snapshot().nodes.database.processed).toBe(1);
  expect(e.snapshot().nodes.source.processed).toBe(1);
});

it("a failed sibling prevents a partial write-back and releases every joined reader", () => {
  const d = cacheAsideFixture();
  (d.nodes[2].props!.cache as CacheTable).default!.coalesce = true;
  d.nodes.push({
    ...d.nodes[3],
    id: "failed-database",
    stencil: "generic.service",
    props: { latencyMs: 300, jitter: 0, failureRate: 1 },
  });
  d.edges.push({ ...d.edges[2], id: "failed-fetch", to: "failed-database" });
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("source", 20);
  e.step(1000);
  expect(e.snapshot().nodes.cache.cache).toMatchObject({ misses: 1, fetches: 1, fills: 0 });
  expect(e.snapshot().nodes.source.failed).toBe(20);
  expect(e.snapshot().inSystem).toBe(0);
});

it("completed deferred dispatches require no empty traversal when replies settle", () => {
  const watch = watchCheckpoints();
  try {
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(cacheAsideFixture());
    e.inject("source", 1);
    e.step(60);
    e.checkpoint();
    const call = [...watch.sources[0][0].get("service")!.calls.values()][0];
    expect(call.deferred).toBeUndefined();
    let enumerations = 0;
    call.deferred = new Proxy([], {
      get(target, key, receiver) {
        if (key === Symbol.iterator) enumerations++;
        return Reflect.get(target, key, receiver);
      },
    });
    e.step(200);
    expect(enumerations).toBe(0);
    expect(e.snapshot().inSystem).toBe(0);
  } finally {
    watch.stop();
  }
});

it("origin retry and breaker clocks start when the miss dispatches, after the lookup", () => {
  const watch = watchCheckpoints();
  try {
    const d = cacheAsideFixture();
    d.nodes[2].props!.latencyMs = 1000;
    d.nodes[3].props!.latencyMs = 2000;
    d.edges[2].props!.caller = {
      onMiss: "lookup",
      wait: "blocking",
      retry: { maxAttempts: 2, backoffMs: 100, strategy: "fixed", retryOn: ["transient"] },
      breaker: { minimumCalls: 1, openMs: 1000 },
    };
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(d);
    e.inject("source", 1);
    e.step(500);
    const token = e.checkpoint();
    const call = [...watch.sources[0][0].get("service")!.calls.values()][0];
    expect(call.branches.get("fetch")).toBeUndefined();
    e.step(600);
    const branch = call.branches.get("fetch")!;
    expect(branch.countedAt).toBeGreaterThan(call.startedAt + 1000);
    expect(branch.attemptStartedAt).toBeGreaterThan(call.startedAt + 1000);
    e.step(3000);
    const result = e.snapshot();
    expect(result.inSystem).toBe(0);
    e.restore(token);
    e.step(3600);
    expect(e.snapshot()).toEqual(result);
  } finally {
    watch.stop();
  }
});

it("a hit never creates database-call bookkeeping", () => {
  const watch = watchCheckpoints();
  try {
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(cacheAsideFixture());
    e.inject("source", 1);
    e.step(500);
    e.inject("source", 1);
    e.step(20);
    e.checkpoint();
    const call = [...watch.sources[0][0].get("service")!.calls.values()][0];
    expect(call.branches.size).toBe(1);
    expect(call.outstanding.size).toBe(1);
    e.step(200);
    expect(call.branches.has("fetch")).toBe(false);
    expect(e.snapshot().nodes.database.processed).toBe(1);
    expect(e.snapshot().nodes.source.processed).toBe(2);
  } finally {
    watch.stop();
  }
});

it.each(["blocking", "non-blocking"] as const)(
  "holds across a %s lookup and a blocking miss, then writes back",
  (wait) => {
    const e = createEngine({
      seed: 7,
      maxParticles: 0,
      verifyLedger: assertLedgerInvariants,
      verifyOutcomes: assertOutcomeInvariants,
    });
    const d = cacheAsideFixture();
    d.edges[1].props!.caller = { wait };
    e.load(d);
    e.inject("source", 1);
    e.step(20);
    expect(e.snapshot().nodes.database.processed).toBe(0);
    expect(e.snapshot().edges.fetch.calls!.inFlight).toBe(0);
    expect(e.threadUsage("service")!.waiting).toBe(1);
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
  },
);

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

it("setup-only cache rules activate the same sequential waiting plan as base rules", () => {
  const d = cacheAsideFixture();
  const expected = analyzeCapacity(d);
  const cache = d.nodes[2].props!.cache;
  delete d.nodes[2].props!.cache;
  const simulation = {
    id: "setup-cache",
    title: "Setup cache",
    traffic: [
      { id: "readers", node: "source", shape: { kind: "constant" as const, ratePerSec: 200, durationMs: 60_000 } },
    ],
    setup: { props: { cache: { cache } } },
  };
  const actual = analyzeCapacity(d, simulation);
  expect(actual.cacheDemand).toEqual(expected.cacheDemand);
  expect(actual.nodes.service.waits).toEqual(expected.nodes.service.waits);
  expect(actual.nodes.service.waits!.threadHoldMs).toBeCloseTo(
    30 + 100 * (1 - actual.cacheDemand!.cache[""].hitRatio),
    8,
  );
});

it.each([false, true])("each lookup weights its own filtered method distribution (coalesce %s)", (coalesce) => {
  const d = cacheAsideFixture();
  (d.nodes[2].props!.cache as CacheTable).default!.coalesce = coalesce;
  d.planning!.requestRoutes = [
    { id: "read", address: { method: "GET", path: "/products" } },
    { id: "write", address: { method: "POST", path: "/products" } },
  ];
  d.nodes[0].props!.trafficMix = { mode: "shares", entries: [{ routeId: "read", share: 1 }] };
  d.nodes.push(
    {
      ...d.nodes[0],
      id: "writers",
      props: {
        ratePerSec: 200,
        trafficMix: {
          mode: "shares",
          entries: [
            { routeId: "read", share: 0.5 },
            { routeId: "write", share: 0.5 },
          ],
        },
      },
    },
    { ...d.nodes[1], id: "write-service" },
  );
  d.edges.push(
    { ...d.edges[0], id: "write-input", from: "writers", to: "write-service" },
    {
      ...d.edges[1],
      id: "write-lookup",
      from: "write-service",
      props: { ...d.edges[1].props, requestFilter: { methods: ["POST"] } },
    },
    {
      ...d.edges[2],
      id: "write-fetch",
      from: "write-service",
      props: { caller: { wait: "blocking", onMiss: "write-lookup", poolConnections: 1 } },
    },
  );
  d.edges[2].props!.caller = { wait: "blocking", onMiss: "lookup", poolConnections: 1 };
  const a = analyzeCapacity(d);
  const cache = a.cacheDemand!.cache[""];
  expect(a.connections["write-lookup"]).toBe(100);
  expect(a.connections["write-fetch"]).toBe(100);
  expect(a.nodes["write-service"].waits!.threadHoldMs).toBe(130);
  expect(a.nodes["write-service"].waits!.poolCeiling).toBe(10);
  expect(a.nodes.service.waits!.threadHoldMs).toBeCloseTo(30 + 100 * (1 - cache.hitRatio), 8);
  expect(a.nodes.service.waits!.poolCeiling).toBeCloseTo(10 / (cache.fetchShare ?? 1 - cache.hitRatio), 8);
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
