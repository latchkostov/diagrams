import { watchCheckpoints } from "../test/checkpointProbe";
import { expect, it, vi } from "vitest";
import { checkpointBytes } from "./engine/checkpoint";
import { createEngine } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { cacheFixture } from "../lab/cacheFixture";
import type { CacheTable } from "../model/caching";
import { createLatencyRecorder, recordLatency } from "./latency";

it("bounds fully populated stale checkpoints at all 256 rules and 4096 tracked items", () => {
  const d = cacheFixture();
  for (let i = 1; i < 8; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[1]), id: `fetch${i}`, from: `cache${i}` });
  }
  for (const node of d.nodes.filter((n) => n.stencil === "generic.cdn"))
    node.props!.cache = {
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `r${i}`,
        match: { types: [`Page${i}`] },
        policy: { ttlMs: 1000, keys: 1000, staleWhileRevalidateMs: 5000 },
      })),
    };
  const watch = watchCheckpoints();
  try {
    const e = createEngine({ seed: 7 });
    e.load(d);
    e.checkpoint();
    const caches = [...watch.sources[0][0].values()].flatMap((n) => (n.cache ? [n.cache] : []));
    const rules = caches.flatMap((c) => c.rules);
    expect(rules).toHaveLength(256);
    expect(rules.reduce((n, r) => n + r.tracked, 0)).toBe(4096);
    for (const cache of caches)
      for (const rule of cache.rules) {
        rule.freshUntil.fill(5000);
        rule.purgedAt = 4000;
        rule.rate = { ...rule.rate, buckets: rule.rate.buckets.slice(), planned: 2000 };
        rule.statisticalUntil = 1000000;
        rule.fetchMs = { ...rule.fetchMs, count: 32, cursor: 0, sum: 3200, samples: new Float64Array(32).fill(100) };
        for (let i = 0; i < 512; i++) cacheRuntime.lookup(cache, `Page${rule.id.slice(1)}`, undefined, true, 5100, 1);
      }
    const credits = rules.map((r) => r.revalidationCredit);
    const packed = e.checkpoint();
    const expected = e.snapshot();
    e.restore(packed);
    expect(e.snapshot()).toEqual(expected);
    expect(
      [...watch.copies[0][0].values()].flatMap((n) => n.cache?.rules.map((r) => r.revalidationCredit) ?? []),
    ).toEqual(credits);
    for (const node of d.nodes) delete node.props?.cache;
    e.load(d);
    const increment = packed.bytes - e.checkpoint().bytes;
    console.info("stale checkpoint increment", increment);
    expect(increment).toBeLessThanOrEqual(130 * 1024);
  } finally {
    watch.stop();
  }
});

it("sizes cycles and aliases once and includes Map/Set payloads", () => {
  const item = { text: "x".repeat(1000) };
  const graph = { item, map: new Map([[item, item]]), set: new Set([item]), self: {} };
  graph.self = graph;
  const before = checkpointBytes(graph);
  expect(before).toBeGreaterThan(1000);
  expect(checkpointBytes({ item, alias: item })).toBe(checkpointBytes({ item }) + 8);
  item.text += "y".repeat(2000);
  expect(checkpointBytes(graph) - before).toBe(4000);
  expect(checkpointBytes(new Map([["key", { text: "x".repeat(1000) }]]))).toBeGreaterThan(1000);
  expect(checkpointBytes(new Set(["x".repeat(1000)]))).toBeGreaterThan(1000);
});

it("charges two bytes per UTF-16 code unit, including Unicode configuration", () => {
  const source = { text: "order ✈ 東京" };
  expect(checkpointBytes(source)).toBe(56 + source.text.length * 2);
});

it("bounds the W3 checkpoint increment at the 4096 tracked-item limit", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: Array.from({ length: 16 }, (_, id) => ({
      id: String(id),
      match: { types: [`Page${id}`] },
      policy: { ttlMs: 1000, keys: 1000 + id },
    })),
  };
  const e = createEngine({ seed: 7 });
  e.load(d);
  const withCache = e.checkpoint().bytes;
  delete d.nodes[1].props!.cache;
  e.load(d);
  expect(withCache - e.checkpoint().bytes).toBeLessThanOrEqual(130 * 1024);
});

it("bounds checkpoints at maximum cache rules and tracked items", () => {
  const d = cacheFixture();
  for (let i = 1; i < 8; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[1]), id: `fetch${i}`, from: `cache${i}` });
  }
  for (const node of d.nodes.filter((n) => n.stencil === "generic.cdn"))
    node.props!.cache = {
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `r${i}`,
        match: { types: [`Page${i}`] },
        policy: { ttlMs: 1000, keys: 1000 },
      })),
    };
  const compile = vi.spyOn(cacheRuntime, "compile");
  const e = createEngine({ seed: 7 });
  try {
    e.load(d);
    expect(compile.mock.results.flatMap((r) => r.value.rules).length).toBe(256);
    expect(compile.mock.results.flatMap((r) => r.value.rules).reduce((sum, r) => sum + r.tracked, 0)).toBe(4096);
    const bytes = e.checkpoint().bytes;
    for (const node of d.nodes) delete node.props?.cache;
    e.load(d);
    expect(bytes - e.checkpoint().bytes).toBeLessThanOrEqual(130 * 1024);
  } finally {
    compile.mockRestore();
  }
});

it("restores untouched shared cache state before its first write", () => {
  const e = createEngine({ seed: 7 });
  e.load(cacheFixture());
  const token = e.checkpoint();
  const play = () => {
    e.setTraffic(true);
    e.step(2000);
    return e.snapshot();
  };
  const expected = play();
  e.restore(token);
  expect(play()).toEqual(expected);
});

it("bounds checkpoints after every cache rule handles a successful miss", () => {
  const d = cacheFixture();
  for (let i = 1; i < 8; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[0]), id: `input${i}`, to: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[1]), id: `fetch${i}`, from: `cache${i}` });
  }
  const caches = d.nodes.filter((n) => n.stencil === "generic.cdn");
  for (const node of caches)
    node.props!.cache = {
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `r${i}`,
        match: { types: [`Page${i}`] },
        policy: { ttlMs: 1000, keys: 1000 },
      })),
    };
  const e = createEngine({ seed: 7 });
  const exercise = () => {
    for (let i = 0; i < 32; i++) e.inject("source", 1, { type: `Page${i}` });
    e.step(1000);
    expect(e.snapshot().inSystem).toBe(0);
  };
  e.load(d);
  exercise();
  for (const node of caches) {
    const rules = Object.values(e.snapshot().nodes[node.id].cache!.rules);
    expect(rules).toHaveLength(32);
    for (const rule of rules) expect(rule).toMatchObject({ requests: 1, misses: 1, fetches: 1 });
  }
  const watch = watchCheckpoints();
  const token = e.checkpoint();
  const rules = [...watch.sources[0][0].values()].flatMap((n) => n.cache?.rules ?? []);
  watch.stop();
  expect(rules).toHaveLength(256);
  expect(rules.reduce((sum, r) => sum + r.tracked, 0)).toBe(4096);
  for (const rule of rules) expect(rule.fetchMs.count).toBe(1);
  const snapshot = e.snapshot();
  exercise();
  const expected = e.snapshot();
  e.restore(token);
  expect(e.snapshot()).toEqual(snapshot);
  exercise();
  expect(e.snapshot()).toEqual(expected);
  for (const node of caches) delete node.props!.cache;
  e.load(d);
  exercise();
  expect(token.bytes - e.checkpoint().bytes).toBeLessThanOrEqual(130 * 1024);
});

it("bounds checkpoints when every rule's fetch samples are full", () => {
  const d = cacheFixture();
  for (let i = 1; i < 8; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[0]), id: `input${i}`, to: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[1]), id: `fetch${i}`, from: `cache${i}` });
  }
  const caches = d.nodes.filter((n) => n.stencil === "generic.cdn");
  for (const node of caches)
    node.props!.cache = {
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `r${i}`,
        match: { types: [`Page${i}`] },
        policy: { ttlMs: 1000, keys: 1000 },
      })),
    };
  const e = createEngine({ seed: 7 });
  const exercise = () => {
    for (let i = 0; i < 32; i++) e.inject("source", 1, { type: `Page${i}` });
    e.step(2000);
    expect(e.snapshot().inSystem).toBe(0);
  };
  e.load(d);
  for (let round = 0; round < 32; round++) exercise();
  for (const node of caches) {
    const rules = Object.values(e.snapshot().nodes[node.id].cache!.rules);
    expect(rules).toHaveLength(32);
    for (const rule of rules) expect(rule).toMatchObject({ requests: 32, misses: 32, fetches: 32 });
  }
  const watch = watchCheckpoints();
  const token = e.checkpoint();
  const rules = [...watch.sources[0][0].values()].flatMap((n) => n.cache?.rules ?? []);
  watch.stop();
  expect(rules).toHaveLength(256);
  expect(rules.reduce((sum, r) => sum + r.tracked, 0)).toBe(4096);
  for (const rule of rules) expect(rule.fetchMs.count).toBe(32);
  const snapshot = e.snapshot();
  exercise();
  const expected = e.snapshot();
  e.restore(token);
  expect(e.snapshot()).toEqual(snapshot);
  exercise();
  expect(e.snapshot()).toEqual(expected);
  for (const node of caches) delete node.props!.cache;
  e.load(d);
  for (let round = 0; round < 32; round++) exercise();
  const baseline = e.checkpoint().bytes;
  console.info({ checkpoint: token.bytes, baseline, increment: token.bytes - baseline });
  expect(token.bytes - baseline).toBeLessThanOrEqual(130 * 1024);
});

it("restores activation capabilities and in-flight rule aliases across cache patches", () => {
  const d = cacheFixture();
  d.nodes[1].stencil = "generic.cache";
  const cache = d.nodes[1].props!.cache as CacheTable;
  delete d.nodes[1].props!.cache;
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { latencyMs: 50, jitter: 0, concurrency: 100, failureRate: 0.5 };
  d.edges[1].props!.caller = {
    retry: { maxAttempts: 3, backoffMs: 10, strategy: "fixed", retryOn: ["transient"] },
    breaker: { minimumCalls: 2, openMs: 1000 },
  };
  const e = createEngine({ seed: 7 });
  e.load(d);
  for (const patch of [undefined, cache, { rules: [], default: { ttlMs: 2000, keys: 1 } }, undefined]) {
    e.setNodeProps("cache", { cache: patch });
    e.inject("source", 10, { spreadMs: 100 });
    e.step(30);
    const watch = watchCheckpoints();
    const token = e.checkpoint();
    const capabilities = (graph: (typeof watch.sources)[number]) =>
      [...graph[0]].map(([id, n]) => ({
        id,
        waits: n.waits,
        frees: n.frees,
        callTarget: n.callTarget,
        edges: n.outgoing.map((edge) => ({ retry: edge.retry, breaker: edge.breaker, calls: edge.calls })),
      }));
    const expectedCapabilities = structuredClone(capabilities(watch.sources[0]));
    const suffix = () => {
      e.setNodeProps("cache", { cache });
      e.step(2000);
      return e.snapshot();
    };
    const expected = suffix();
    e.restore(token);
    expect(capabilities(watch.copies[0])).toEqual(expectedCapabilities);
    watch.stop();
    expect(suffix()).toEqual(expected);
  }
});

it("bounds warm checkpoints with full fetch rings", () => {
  const d = cacheFixture();
  for (let i = 1; i < 8; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[0]), id: `input${i}`, to: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[1]), id: `fetch${i}`, from: `cache${i}` });
  }
  const caches = d.nodes.filter((n) => n.stencil === "generic.cdn");
  for (const node of caches)
    node.props!.cache = {
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `r${i}`,
        match: { types: [`Page${i}`] },
        policy: { ttlMs: 1000, keys: 1000 },
      })),
    };
  const rates = Object.fromEntries(
    caches.map((n) => [
      n.id,
      Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`r${i}`, { rate: 1e15, fetchMs: 0 }])),
    ]),
  );
  const e = createEngine({ seed: 7 });
  e.load(d, rates);
  const watch = watchCheckpoints();
  e.checkpoint();
  const rules = [...watch.sources[0][0].values()].flatMap((n) => n.cache?.rules ?? []);
  watch.stop();
  expect(rules).toHaveLength(256);
  expect(rules.reduce((sum, r) => sum + r.freshUntil.filter((v) => v > 0 && !Number.isInteger(v)).length, 0)).toBe(
    4096,
  );
  for (const node of watch.sources[0][0].values())
    for (const rule of node.cache?.rules ?? []) {
      rule.counts = { ...rule.counts };
      // Successful tail misses populate the real runtime ring without overwriting the warm tracked items.
      for (let i = 0; i < 32; i++) {
        const lookup = { rule, item: -1, outcome: "miss" as const, at: 0 };
        const cache = node.cache!;
        cacheRuntime.start(cache, lookup, 1);
        cacheRuntime.settle(cache, lookup, 70, 1, true);
        recordLatency((cache.latency ??= createLatencyRecorder()), "miss", 70, 0, 0);
      }
      expect(rule.fetchMs.count).toBe(32);
    }
  e.step(80);
  const token = e.checkpoint();
  const snapshot = e.snapshot();
  const play = () => {
    for (let i = 0; i < 32; i++) e.inject("source", 1, { type: `Page${i}` });
    e.step(2000);
    return e.snapshot();
  };
  const expected = play();
  e.restore(token);
  expect(e.snapshot()).toEqual(snapshot);
  expect(play()).toEqual(expected);
  for (const node of caches) delete node.props!.cache;
  e.load(d);
  const baseline = e.checkpoint().bytes;
  console.info({ warmCheckpoint: token.bytes, baseline, increment: token.bytes - baseline });
  expect(token.bytes - baseline).toBeLessThanOrEqual(133_120);
});
