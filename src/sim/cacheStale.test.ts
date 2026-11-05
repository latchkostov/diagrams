import { watchCheckpoints } from "../test/checkpointProbe";
import { assertCacheInvariants } from "./cacheInvariants";
import fc from "fast-check";
import { expect, it } from "vitest";
import { cacheRuntime } from "./cache/cacheRuntime";
import { CacheCheckpoint } from "./cache/cacheCheckpoint";
import { propertyRuns } from "../test/fastCheck";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { itemHitShare, cacheFetchShare } from "./cache/cacheMath";
import type { CacheTable } from "../model/caching";
import { parseMessage, encodeMessage, LiveDecoder } from "../collab/room/liveWire";

const table = (window = 1000): CacheTable => ({
  rules: [],
  default: { ttlMs: 1000, keys: 1, staleWhileRevalidateMs: window },
});
const compile = (window = 1000) => cacheRuntime.compile(table(window), "cache", 7, 1, { value: 256 });

it("C4: fresh and stale hits respect both deadlines, including absent entries and a zero window", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 15000 }), (window, now) => {
      const cache = compile(window);
      const rule = cache.rules[0];
      rule.freshUntil[0] = 5000;
      const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, now, 1);
      expect(lookup.outcome).toBe(now < 5000 ? "hit" : now < 5000 + window ? "stale" : "miss");
      expect(!!lookup.revalidate).toBe(lookup.outcome === "stale");
      rule.freshUntil[0] = -1;
      expect(cacheRuntime.lookup(cache, "Page", undefined, true, now, 1).outcome).toBe("miss");
    }),
    { numRuns: propertyRuns(100) },
  );
});

it("C6: hard purge empties exactly the selected rules; soft purge preserves copies only within a stale window", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5000 }), fc.boolean(), fc.boolean(), (now, soft, targeted) => {
      const cache = cacheRuntime.compile(
        {
          rules: [
            { id: "a", match: { types: ["A"] }, policy: { ttlMs: 1000, keys: 1, staleWhileRevalidateMs: 5000 } },
            { id: "b", match: { types: ["B"] }, policy: { ttlMs: 1000, keys: 1 } },
          ],
        },
        "cache",
        7,
        1,
        { value: 256 },
      );
      for (const r of cache.rules) r.freshUntil[0] = now + 100;
      cacheRuntime.purge(cache, now, targeted ? "a" : undefined, soft ? "soft" : "hard");
      expect(cache.rules[0].freshUntil[0]).toBe(soft ? now : -1);
      expect(cache.rules[1].freshUntil[0]).toBe(targeted ? now + 100 : -1);
      expect(cacheRuntime.lookup(cache, "A", undefined, true, now, 1).outcome).toBe(soft ? "stale" : "miss");
    }),
    { numRuns: propertyRuns(100) },
  );
});

it("a failed refresh leaves the original stale deadline unchanged and a later request can retry", () => {
  const cache = compile();
  cache.rules[0].freshUntil[0] = 1000;
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 1100, 1);
  cacheRuntime.start(cache, lookup, 1);
  expect(cacheRuntime.lookup(cache, "Page", undefined, true, 1200, 1).revalidate).toBeUndefined();
  cacheRuntime.settle(cache, lookup, 1300, 1, false);
  expect(cacheRuntime.lookup(cache, "Page", undefined, true, 1400, 1).revalidate).toBe(1);
  expect(cacheRuntime.lookup(cache, "Page", undefined, true, 2000, 1).outcome).toBe("miss");
});

it.each(["hard", "soft"] as const)("a %s purge preserves an in-flight reply's fill and checkpoint state", (mode) => {
  const cache = compile();
  cache.rules[0].freshUntil[0] = 1000;
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 1100, 1);
  cacheRuntime.start(cache, lookup, 1);
  cacheRuntime.purge(cache, 1200, undefined, mode);
  const packed = new CacheCheckpoint(cache.rules[0]);
  expect(packed.restore()).toEqual(cache.rules[0]);
  cacheRuntime.settle(cache, lookup, 1300, 1, true);
  expect(cache.rules[0].freshUntil[0]).toBe(2300);
});

it("a miss waiting at the cache can start after a hard purge and still fill on reply", () => {
  const cache = compile();
  cache.rules[0].freshUntil[0] = 1000;
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 2100, 1);
  expect(lookup.outcome).toBe("miss");
  cacheRuntime.purge(cache, 2110);
  cacheRuntime.start(cache, lookup, 1, 2120);
  cacheRuntime.settle(cache, lookup, 2130, 1, true);
  expect(cache.rules[0].freshUntil[0]).toBe(3130);
});

it("soft purge ignores Don't store rules when reporting cold-cache evidence", () => {
  const cache = cacheRuntime.compile(
    {
      rules: [
        { id: "stored", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 1, staleWhileRevalidateMs: 5000 } },
        { id: "personal", match: { types: ["Private"] }, policy: { noStore: true } },
      ],
    },
    "cache",
    7,
    1,
    { value: 256 },
  );
  cacheRuntime.purge(cache, 100, undefined, "soft");
  expect(cacheRuntime.details(cache, 100).purge).toBeUndefined();
  cacheRuntime.purge(cache, 200);
  cacheRuntime.purge(cache, 300, undefined, "soft");
  expect(cacheRuntime.details(cache, 300).purge?.atMs).toBe(200);
});

it.each([1, 10, 50])(
  "stale hits reply independently of the one real background fetch at scale %i; purges replay",
  (scale) => {
    const d = cacheFixture();
    d.nodes[1].props!.cache = table(5000);
    d.edges[0].props = { networkDelayMs: 0, caller: { deadlineMs: 50 } };
    d.edges[1].props = { networkDelayMs: 100, caller: { deadlineMs: 1000 } };
    const e = createEngine({ seed: 7, maxParticles: 0 });
    e.load(d, { cache: { "": { rate: 5000, fetchMs: 0 } } });
    e.setScale(scale);
    e.step(1010);
    e.inject("source", 30);
    e.step(30);
    expect(e.snapshot().nodes.cache.cache).toMatchObject({
      hits: 30 * scale,
      staleHits: 30 * scale,
      revalidations: 1,
      fetches: 1,
    });
    expect(e.snapshot().nodes.source.failed).toBe(0);
    const checkpoint = e.checkpoint();
    expect(checkpoint.bytes).toBeLessThan(130 * 1024);
    const suffix = () => {
      e.setFault({ kind: "purge", node: "cache", reason: "deploy" });
      e.step(1000);
      e.inject("source", 1);
      e.step(1000);
      return e.snapshot();
    };
    const result = suffix();
    expect(result.nodes.cache.cache!.fills).toBe(1);
    expect(result.nodes.cache.cache!.fetches).toBe(1);
    expect(result.inSystem).toBe(0);
    expect(result.faults).toBeUndefined();
    e.restore(checkpoint);
    expect(suffix()).toEqual(result);
  },
);

it("stale hits and refreshes use the approved cycle formula", () => {
  const p = { ttlMs: 10000, keys: 1, staleWhileRevalidateMs: 5000 };
  expect(itemHitShare(900, p.ttlMs, 300, p.staleWhileRevalidateMs)).toBe(1);
  expect(cacheFetchShare(p, 900, 300)).toBeCloseTo(1 / 9271, 12);
  const short = { ttlMs: 1000, keys: 1, staleWhileRevalidateMs: 1000 };
  expect(itemHitShare(100, short.ttlMs, 5000, short.staleWhileRevalidateMs)).toBeCloseTo(200 / 601, 12);
  expect(cacheFetchShare(short, 100, 5000)).toBeCloseTo(402 / 601, 12);
  expect(cacheFetchShare({ ...short, coalesce: true }, 100, 5000)).toBeCloseTo(1 / 601, 12);
});

it("purge evidence names the purged tail and observed origin, not an untouched larger rule", () => {
  const cache = cacheRuntime.compile(
    {
      rules: [
        { id: "small", match: { types: ["Small"] }, policy: { ttlMs: 1000, keys: 1 } },
        { id: "tail", match: { types: ["Tail"] }, policy: { ttlMs: 300000, keys: 20000 } },
      ],
    },
    "cache",
    7,
    1,
    { value: 256 },
    { small: { rate: 100, fetchMs: 10 }, tail: { rate: 80, fetchMs: 10 } },
  );
  cacheRuntime.purge(cache, 100, "small");
  const lookup = cacheRuntime.lookup(cache, "Small", undefined, true, 110, 1);
  lookup.origin = "selected-origin";
  cacheRuntime.start(cache, lookup, 1);
  expect(cacheRuntime.details(cache, 110).purge).toMatchObject({
    tailItems: 1,
    refillMs: 10,
    edge: "selected-origin",
    hard: true,
  });
  cacheRuntime.purge(cache, 200, "tail");
  expect(cacheRuntime.details(cache, 200).purge).toMatchObject({ tailItems: 20000, refillMs: 250000 });
});

it("keeps the reported tail size and refill bound on the same purged rule", () => {
  const cache = cacheRuntime.compile(
    {
      rules: [
        { id: "large", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 20000 } },
        { id: "tiny", match: { types: ["Tiny"] }, policy: { ttlMs: 1000, keys: 1 } },
      ],
    },
    "cache",
    7,
    1,
    { value: 256 },
    { large: { rate: 1000000, fetchMs: 10 }, tiny: { rate: 0.001, fetchMs: 10 } },
  );
  cacheRuntime.purge(cache, 100);
  expect(cacheRuntime.details(cache, 100).purge).toMatchObject({ tailItems: 20000, refillMs: 20 });
});

it.each(["hard", "soft"] as const)(
  "shared Live preserves a %s per-rule deploy purge and rejects invalid modes",
  (mode) => {
    const message = {
      t: "op" as const,
      run: "purges.1",
      entry: {
        seq: 1,
        tick: 100,
        op: {
          kind: "fault" as const,
          fault: { kind: "purge" as const, node: "cache", rule: "__all", mode, reason: "deploy" as const },
        },
      },
    };
    expect(parseMessage(message)).toEqual(message);
    const decoder = new LiveDecoder();
    const parts = encodeMessage(message, 7)!;
    expect(parts.map((p) => decoder.push("host", p)).at(-1)).toEqual(message);
    expect(
      parseMessage({
        ...message,
        entry: { ...message.entry, op: { ...message.entry.op, fault: { ...message.entry.op.fault, mode: "clear" } } },
      }),
    ).toBeUndefined();
  },
);

it("soft purge at time zero preserves warm copies", () => {
  for (const tracked of [0, 256]) {
    for (const mode of ["soft", "hard"] as const) {
      const cache = cacheRuntime.compile(
        table(),
        "cache",
        7,
        1,
        { value: tracked },
        { "": { rate: 1000, fetchMs: 10 } },
      );
      cache.rules[0].freshUntil.fill(1000);
      cacheRuntime.purge(cache, 0, undefined, mode);
      const restored = new CacheCheckpoint(cache.rules[0]).restore();
      expect(restored).toEqual(cache.rules[0]);
      const outcomes = Array.from(
        { length: 100 },
        () => cacheRuntime.lookup(cache, "Page", undefined, true, 0, 1).outcome,
      );
      expect(outcomes.filter((o) => o === "hit" || o === "stale").length).toBe(mode === "soft" ? 100 : 0);
    }
  }
});

it("hard purge, partial refill, soft purge leaves missing statistical copies as misses", () => {
  const cache = cacheRuntime.compile(
    { rules: [], default: { ttlMs: 300000, keys: 20000, popularity: "even", staleWhileRevalidateMs: 60000 } },
    "cache",
    7,
    1,
    { value: 0 },
    { "": { rate: 1000, fetchMs: 10 } },
  );
  cacheRuntime.purge(cache, 1000);
  const miss = cacheRuntime.lookup(cache, "Page", undefined, true, 1010, 1);
  cacheRuntime.start(cache, miss, 1);
  cacheRuntime.settle(cache, miss, 1020, 1, true);
  cacheRuntime.purge(cache, 1030, undefined, "soft");
  expect(cache.rules[0].warmSince).toBe(1000);
  const hits = Array.from({ length: 1000 }, () => cacheRuntime.lookup(cache, "Page", undefined, true, 1040, 1)).filter(
    (r) => r.outcome === "hit" || r.outcome === "stale",
  ).length;
  expect(hits).toBeLessThan(1000 / 8);
});

it.each(["down", "paused"] as const)("statistical background refreshes expire when the origin is %s", (status) => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 1000;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 1, staleWhileRevalidateMs: 10000 } };
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d, { cache: { "": { rate: 1000, fetchMs: 60 } } });
  e.setTraffic(true);
  e.step(1000);
  expect(e.snapshot().nodes.cache.cache!.revalidations).toBeGreaterThan(0);
  e.setNodeStatus("origin", status);
  e.step(11000);
  const checkpoint = e.checkpoint();
  const before = e.snapshot().nodes.cache.cache!;
  e.step(1000);
  const after = e.snapshot().nodes.cache.cache!;
  expect(after.hits).toBe(before.hits);
  expect(after.misses - before.misses).toBeGreaterThan(0);
  e.restore(checkpoint);
  e.step(1000);
  expect(e.snapshot().nodes.cache.cache).toEqual(after);
});

it("stalled refreshes cannot outlive TTL plus the stale window while awaiting a slower fetch", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 1000;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 1, staleWhileRevalidateMs: 100 } };
  d.nodes[2].props!.latencyMs = 990;
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d, { cache: { "": { rate: 1000, fetchMs: 1000 } } });
  e.setTraffic(true);
  e.step(5000);
  expect(e.snapshot().nodes.cache.cache!.revalidations).toBeGreaterThan(0);
  e.setNodeStatus("origin", "paused");
  e.step(500);
  const before = e.snapshot().nodes.cache.cache!;
  e.step(200);
  const after = e.snapshot().nodes.cache.cache!;
  expect(after.hits).toBe(before.hits);
  expect(after.misses - before.misses).toBeGreaterThan(0);
});

it("each purge restarts aggregate and per-type latency windows", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = table(5000);
  const e = createEngine({ seed: 7, maxParticles: 0 });
  e.load(d);
  e.setLatencySinceFault(true);
  const collect = () => {
    e.inject("source", 2, { type: "Page" });
    e.inject("source", 3, { type: "Product" });
    e.step(500);
  };
  collect();
  for (const mode of ["hard", "hard", "soft", "soft"] as const) {
    const before = e.snapshot();
    const fault = { kind: "purge", node: "cache", mode } as const;
    const now = before.time;
    expect(before.nodes.source.latency!.samples).toBe(5);
    expect(before.nodes.source.latency!.byType).toMatchObject({ Page: { samples: 2 }, Product: { samples: 3 } });
    e.setFault(fault);
    expect(e.snapshot().nodes.source.latency).toBeUndefined();
    expect(e.snapshot().nodes.cache.latency).toBeUndefined();
    expect(e.snapshot().nodes.cache.processed).toBe(before.nodes.cache.processed);
    expect(e.snapshot().nodes.cache.cache!.requests).toBe(before.nodes.cache.cache!.requests);
    const checkpoint = e.checkpoint();
    collect();
    const result = e.snapshot();
    expect(result.nodes.source.latency).toMatchObject({
      samples: 5,
      byType: { Page: { samples: 2 }, Product: { samples: 3 } },
      sinceFault: { atMs: now, fault },
    });
    e.restore(checkpoint);
    collect();
    expect(e.snapshot()).toEqual(result);
  }
});

it("statistical refresh dispatch uses one weighted batch per sampled arrival", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 1000000;
  d.nodes[1].props!.cache = {
    rules: [],
    default: { ttlMs: 100, keys: 1000000, popularity: "even", staleWhileRevalidateMs: 60000 },
  };
  const e = createEngine({ seed: 7, scale: 1000000, maxParticles: 0, messageBudget: { remaining: 24 } });
  e.load(d, { cache: { "": { rate: 1000000, fetchMs: 60 } } });
  e.inject("source", 1);
  const watch = watchCheckpoints();
  try {
    e.checkpoint();
    expect(() => e.step(20)).not.toThrow();
    const node = watch.sources[0][0].get("cache")!;
    expect(node.cache!.flights!.size).toBe(1);
    assertCacheInvariants(node.cache!, false, node.calls.values());
    expect(() => e.step(480)).not.toThrow();
    assertCacheInvariants(node.cache!, true, node.calls.values());
  } finally {
    watch.stop();
  }
  const cache = e.snapshot().nodes.cache.cache!;
  expect(cache.requests).toBe(1000000);
  expect(cache.revalidations).toBeGreaterThan(100000);
  expect(cache.fetches).toBe(cache.revalidations);
  expect(e.snapshot().nodes.origin.processed * 1000000).toBe(cache.revalidations);
  expect(e.snapshot().inSystem).toBe(0);
});

it("statistical refreshes preserve credit without allocating at call capacity", () => {
  const cache = cacheRuntime.compile(
    { rules: [], default: { ttlMs: 100, keys: 1000000, popularity: "even", staleWhileRevalidateMs: 60000 } },
    "cache",
    7,
    1000000,
    { value: 0 },
    { "": { rate: 1000000, fetchMs: 60 } },
  );
  const lookup = cacheRuntime.lookup(cache, "Page", undefined, true, 100, 1000000);
  expect(lookup.revalidate).toBeGreaterThan(0);
  const credit = cache.rules[0].revalidationCredit!;
  expect(cacheRuntime.refreshReady(cache, lookup, 100, 0)).toBe(false);
  expect(cache.flights).toBeUndefined();
  expect(cache.rules[0].revalidationCredit).toBe(credit + lookup.revalidate!);
  const next = cacheRuntime.lookup(cache, "Page", undefined, true, 110, 1000000);
  expect(next.revalidate).toBeGreaterThanOrEqual(lookup.revalidate!);
  expect(cacheRuntime.refreshReady(cache, next, 110, 1)).toBe(true);
});

it("tracked-item and statistical-refresh flight keys cannot collide with delimiter-bearing rule IDs", () => {
  expect(cacheRuntime.flightKey("products", -1, 42)).not.toBe(cacheRuntime.flightKey("products:-1", 42));
  const cache = cacheRuntime.compile(
    {
      rules: [{ id: "products:-1", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 1, popularity: "even" } }],
    },
    "cache",
    7,
    1,
    { value: 256 },
  );
  // Observation uses the same key namespace as registration and cleanup.
  const key = cacheRuntime.flightKey("products:-1", 0);
  cache.flights = new Map([
    [key, { cacheFlight: { key, waiting: 7, waiters: [] }, remaining: 0 } as unknown as import("./engine/model").Work],
  ]);
  expect(cacheRuntime.observeItem(cache, "products:-1", 1)?.waiting).toBe(7);
});
