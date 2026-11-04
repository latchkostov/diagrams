import { expect, it, vi } from "vitest";
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
import { createSimulationRun } from "./simulation";

it("replays prefix reply particles after rewinding timeline cache activation", () => {
  const d = cacheFixture();
  d.nodes[1].stencil = "generic.cache";
  const cache = d.nodes[1].props!.cache;
  delete d.nodes[1].props!.cache;
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { latencyMs: 10, jitter: 0, concurrency: 100, failureRate: 1 };
  // The direct caller fails in the prefix, while the store's policy stays dormant.
  d.edges[0].to = "origin";
  d.edges[1].props!.caller = {
    retry: { maxAttempts: 3, backoffMs: 10, strategy: "fixed", retryOn: ["transient"] },
    breaker: { minimumCalls: 2, openMs: 10_000 },
  };
  const run = createSimulationRun(d, {
    id: "rewind",
    title: "Rewind activation",
    seed: 7,
    durationMs: 1000,
    traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 200, durationMs: 1000 } }],
    timeline: [{ atMs: 500, action: { do: "props", node: "cache", props: { cache } } }],
  });
  run.step(100);
  const token = run.checkpoint();
  const prefix = () =>
    Array.from({ length: 20 }, () => {
      run.step(10);
      return run.engine.snapshot();
    });
  const expected = prefix();
  const replies = expected.flatMap((s) => s.particles.filter((p) => p.kind === "reply"));
  expect(replies.length).toBeGreaterThan(0);
  expect(replies.every((p) => p.code === undefined)).toBe(true);
  run.step(300);
  expect(run.engine.snapshot().nodes.cache.cache).toBeDefined();
  expect(run.engine.snapshot().edges.fetch.breaker).toBeDefined();
  expect(run.engine.snapshot().particles.some((p) => p.kind === "reply" && p.code === 500)).toBe(true);
  for (let repeat = 0; repeat < 2; repeat++) {
    run.restore(token);
    expect(run.engine.snapshot().nodes.cache.cache).toBeUndefined();
    expect(run.engine.snapshot().edges.fetch.breaker).toBeUndefined();
    expect(prefix()).toEqual(expected);
    run.step(300);
  }
});

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

it("discards an old cycle's duplicate even after its first fill has expired", () => {
  const c = cacheRuntime.compile({ rules: [], default: { ttlMs: 1000, keys: 1 } }, "edge", 7, 1, { value: 4096 });
  const first = cacheRuntime.lookup(c, "Page", undefined, true, 0, 1);
  const duplicate = cacheRuntime.lookup(c, "Page", undefined, true, 500, 1);
  cacheRuntime.start(c, first, 1);
  cacheRuntime.start(c, duplicate, 1);
  cacheRuntime.settle(c, first, 1500, 1, true);
  cacheRuntime.settle(c, duplicate, 2600, 1, true);
  expect(c.rules[0].freshUntil[0]).toBe(2500);
  expect(c.counts.fills).toBe(1);
  const next = cacheRuntime.lookup(c, "Page", undefined, true, 2600, 1);
  expect(next.outcome).toBe("miss");
  cacheRuntime.start(c, next, 1);
  cacheRuntime.settle(c, next, 4100, 1, true);
  expect(c.rules[0].freshUntil[0]).toBe(5100);
  expect(c.counts.fills).toBe(2);
});

it("statistical availability survives sampled gaps but expires after failed fetches", () => {
  const c = cacheRuntime.compile(
    { rules: [], default: { ttlMs: 100, keys: 20, popularity: "even" } },
    "edge",
    7,
    10,
    { value: 4096 },
    { "": { rate: 200, fetchMs: 10 } },
  );
  const arrive = (at: number, ok: boolean) => {
    const lookup = cacheRuntime.lookup(c, "Page", undefined, true, at, 10);
    if (lookup.outcome === "miss") {
      cacheRuntime.start(c, lookup, 10);
      cacheRuntime.settle(c, lookup, at + 10, 10, ok);
    }
  };
  for (let i = 0; i < 100; i++) arrive(1000 + 50 * i, true);
  expect(c.counts.hits).toBeGreaterThan(0);
  for (let i = 100; i < 200; i++) arrive(1000 + 50 * i, false);
  const hits = c.counts.hits;
  for (let i = 200; i < 300; i++) arrive(1000 + 50 * i, false);
  expect(c.counts.hits).toBe(hits);
  expect(c.counts.fetches).toBe(c.counts.misses);
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
  // Failed fetches cannot manufacture statistical hits to terminate nested retries.
  // Timeout does not cancel downstream retries; the finite recovery bound still drains them all.
  expect(e.metrics().inSystem).toBe(26);
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

it("automatic scale preserves the dot budget for short-TTL statistical rules", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 2000;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 20, popularity: "even" } };
  const simulation = {
    id: "short-ttl",
    title: "Short TTL",
    traffic: [{ id: "load", node: "source", shape: { kind: "constant" as const, ratePerSec: 2000, durationMs: 1000 } }],
  };
  const rates = cacheRuntime.plan(d, simulation);
  expect(rates.cache[""].rate).toBe(2000);
  expect(autoScale(simulation, d, rates)).toBe(50);
  expect(autoScale(simulation, d)).toBe(50);
  const cache = cacheRuntime.compile(d.nodes[1].props!.cache, "cache", 7, 50, { value: 4096 }, rates.cache);
  expect(cache.rules[0].tracked).toBe(0);
});

it("warm statistical hits expire after the last successful fill when the origin pauses without a deadline", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 20, popularity: "even" } };
  const e = createEngine({ seed: 7, scale: 1, maxParticles: 0 });
  e.load(d, cacheRuntime.plan(d));
  e.setTraffic(true);
  e.step(2000);
  expect(e.snapshot().nodes.cache.cache!.hits).toBeGreaterThan(0);
  e.setNodeStatus("origin", "paused");
  // Allow replies already returning at the pause to fill, then expire their TTL.
  e.step(200);
  const hits = e.snapshot().nodes.cache.cache!.hits;
  const fetches = e.snapshot().nodes.cache.cache!.fetches;
  e.step(2000);
  expect(e.snapshot().nodes.cache.cache!.fetches).toBeGreaterThan(fetches);
  expect(e.snapshot().nodes.cache.cache!.hits).toBe(hits);
});

it("coarse statistical fills stop making progress during a pause and replay their overdue clock", () => {
  const d = cacheFixture();
  d.nodes[0].props!.ratePerSec = 2000;
  d.nodes[2].props!.latencyMs = 0;
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 1, popularity: "even" } };
  const e = createEngine({ seed: 7, scale: 50, maxParticles: 0 });
  e.load(d, cacheRuntime.plan(d));
  e.setTraffic(true);
  e.step(2000);
  expect(e.snapshot().nodes.cache.cache!.hitRatio).toBeGreaterThan(0.87);
  e.setNodeStatus("origin", "paused");
  e.step(500);
  const token = e.checkpoint();
  const before = e.snapshot().nodes.cache.cache!;
  const suffix = () => {
    e.step(2000);
    return e.snapshot();
  };
  const expected = suffix();
  expect(expected.nodes.cache.cache!.hits).toBe(before.hits);
  expect(expected.nodes.cache.cache!.fetches).toBeGreaterThan(before.fetches);
  e.restore(token);
  expect(suffix()).toEqual(expected);
  e.setNodeStatus("origin", "up");
  e.step(2000);
  expect(e.snapshot().nodes.cache.cache!.hits).toBeGreaterThan(before.hits);
});

it("cold statistical cache never hits when every fetch fails", () => {
  const d = cacheFixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { latencyMs: 10, jitter: 0, concurrency: 1000, failureRate: 1 };
  const e = createEngine({ seed: 7, scale: 10 });
  e.load(d);
  e.setTraffic(true);
  e.step(10_000);
  const c = e.snapshot().nodes.cache.cache!;
  expect(c.fetches).toBeGreaterThan(0);
  expect(c.fills).toBe(0);
  expect(c.hits).toBe(0);
});

it("warm statistical hits stop after the TTL during an origin outage", () => {
  const d = cacheFixture();
  const e = createEngine({ seed: 7, scale: 10 });
  e.load(d, cacheRuntime.plan(d));
  e.setNodeStatus("origin", "down");
  e.setTraffic(true);
  e.step(500);
  expect(e.snapshot().nodes.cache.cache!.hits).toBeGreaterThan(0);
  e.step(1000);
  const hits = e.snapshot().nodes.cache.cache!.hits;
  e.step(5000);
  expect(e.snapshot().nodes.cache.cache!.hits).toBe(hits);
});

it.each(["setup", "timeline"])(
  "%s-only read-through activation initializes retries, breakers and target reservations",
  async (where) => {
    const { createSimulationRun } = await import("./simulation");
    const d = cacheFixture();
    d.nodes[1].stencil = "generic.cache";
    const cache = d.nodes[1].props!.cache;
    delete d.nodes[1].props!.cache;
    d.nodes[2].stencil = "generic.service";
    d.nodes[2].props = { latencyMs: 10, jitter: 0, concurrency: 100, failureRate: 1 };
    d.edges[1].props!.caller = {
      retry: { maxAttempts: 3, backoffMs: 10, strategy: "fixed", retryOn: ["transient"] },
      breaker: { minimumCalls: 2, openMs: 10_000 },
    };
    let reserved = false;
    const run = createSimulationRun(
      d,
      {
        id: "activate",
        title: "Activate",
        seed: 7,
        scale: 10,
        durationMs: 2000,
        traffic: [
          { id: "load", node: "source", shape: { kind: "constant", ratePerSec: 200, durationMs: 1000, fromMs: 200 } },
        ],
        ...(where === "setup"
          ? { setup: { props: { cache: { cache } } } }
          : { timeline: [{ atMs: 100, action: { do: "props" as const, node: "cache", props: { cache } } }] }),
      },
      {
        verifyLedger: (state) => {
          if ([...state.ledger.reservations.values()].some((r) => r.owner === "origin" && r.scope === "request"))
            reserved = true;
        },
      },
    );
    run.step(2000);
    const s = run.engine.snapshot();
    expect(s.edges.fetch.calls!.retried).toBeGreaterThan(0);
    expect(s.edges.fetch.calls!.shortCircuited).toBeGreaterThan(0);
    expect(s.edges.fetch.breaker!.state).toBe("open");
    expect(reserved).toBe(true);
    expect(s.inSystem).toBe(0);
  },
);

it("sampling uses peak demand, warming uses initial demand, and idle rules do not constrain scale", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: [{ id: "idle", match: { types: ["Unused"] }, policy: { ttlMs: 1000 } }],
    default: { ttlMs: 86_400_000, keys: 1 },
  };
  const sim = {
    id: "ramp",
    title: "Ramp",
    traffic: [
      {
        id: "r",
        node: "source",
        shape: {
          kind: "ramp" as const,
          startRate: 0,
          stages: [{ targetRate: 10_000, durationMs: 60_000 }],
        },
      },
    ],
  };
  expect(autoScale(sim, d)).toBe(200);
  expect(cacheRuntime.plan(d, sim).cache?.[""]?.rate ?? 0).toBe(0);
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 5000, keys: 1000 } };
  const peak = {
    ...sim,
    traffic: [{ ...sim.traffic[0], shape: { kind: "constant" as const, ratePerSec: 10_000, durationMs: 60_000 } }],
  };
  const expected = autoScale(peak, d);
  expect(expected).toBeGreaterThan(1);
  expect(expected).toBeLessThan(200);
  expect(autoScale(sim, d)).toBe(expected);
});

it("origin property lookup does not rescan the edge array in the demand solver", () => {
  const d = cacheFixture();
  const find = vi.spyOn(d.edges, "find");
  analyzeCapacity(d);
  expect(find).not.toHaveBeenCalled();
  find.mockRestore();
});
