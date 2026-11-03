import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { createSimulationRun } from "./simulation";
import { createEngine } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { cacheTraceWords } from "../trace/cacheWords";
import { buildScript } from "../live/slowmo/script";
import { stencilRole } from "../stencils/roles";
import { explainNode } from "../planning/explanation";
import { analyzeCapacity } from "./capacity";

it("includes the cache's own service time in miss latency", () => {
  const d = cacheFixture();
  const run = (service: number) => {
    d.nodes[1].props!.latencyMs = service;
    d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 1_000_000, popularity: "even" } };
    const e = createEngine({ seed: 7 });
    e.load(d, cacheRuntime.plan(d));
    e.inject("source", 1, { type: "Page" });
    e.step(1000);
    const s = e.snapshot().nodes.cache;
    expect(s.cache!.misses).toBe(1);
    return s.cacheDetails!.latency!.miss!.waitMs;
  };
  expect(run(40) - run(0)).toBe(40);
});

it("measures window percentages, cumulative origin fetches and unscaled p95 at sampled scale", () => {
  const d = cacheFixture();
  const simulation = {
    id: "cache",
    title: "Cache",
    seed: 7,
    scale: 10,
    durationMs: 5000,
    traffic: [
      { id: "readers", node: "source", shape: { kind: "constant" as const, ratePerSec: 200, durationMs: 3000 } },
    ],
    expectations: [
      {
        id: "ratio",
        label: "Hits",
        metric: { node: "cache", field: "hitRatio" as const },
        op: ">" as const,
        value: 50,
        when: "end" as const,
      },
    ],
  };
  const run = createSimulationRun(d, simulation);
  run.step(5000);
  const s = run.engine.snapshot();
  const w = s.nodes.cache.cacheDetails!.window!;
  expect(run.engine.measure({ node: "cache", field: "hitRatio" })).toBeCloseTo((100 * w.hits) / (w.hits + w.misses));
  expect(run.state().expectations[0].status).toBe("pass");
  expect(run.engine.measure({ node: "cache", field: "originOffload" })).toBeCloseTo(100 * (1 - w.fetches / w.requests));
  expect(run.engine.measure({ node: "cache", field: "originFetches" })! * 10).toBe(s.nodes.cache.cache!.fetches);
  expect(run.engine.measure({ node: "source", field: "p95" })).toBe(s.nodes.source.latency!.p95);
  const latency = s.nodes.cache.cacheDetails!.latency!;
  expect(latency.hit!.samples).toBeGreaterThan(0);
  expect(latency.miss!.p95).toBeGreaterThan(latency.hit!.p95);
  run.engine.step(11_000);
  expect(run.engine.measure({ node: "cache", field: "hitRatio" })).toBe(0);
  expect(run.engine.measure({ node: "cache", field: "originOffload" })).toBe(0);
});

it("keeps no-store requests outside the hit ratio, and restores windows and split histograms exactly", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: [{ id: "pages", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 20 } }],
    default: { noStore: true },
  };
  const e = createEngine({ seed: 7 });
  e.load(d, cacheRuntime.plan(d));
  e.inject("source", 200, { type: "Page", spreadMs: 1000 });
  e.inject("source", 200, { type: "Personal", spreadMs: 1000 });
  e.step(2000);
  const c = e.snapshot().nodes.cache.cache!;
  expect(c.notCached).toBe(200);
  expect(e.measure({ node: "cache", field: "hitRatio" })).toBeCloseTo((100 * c.hits) / (c.hits + c.misses));
  const token = e.checkpoint();
  const suffix = () => {
    e.inject("source", 50, { type: "Page", spreadMs: 1000 });
    e.step(2000);
    return e.snapshot();
  };
  const expected = suffix();
  e.restore(token);
  expect(suffix()).toEqual(expected);
});

it("tells the cache outcome in the trace, slow motion and event log without changing event identities", () => {
  const d = cacheFixture();
  const e = createEngine({ seed: 7, traceHistory: 50 });
  e.load(d, cacheRuntime.plan(d));
  e.setTraffic(true);
  e.step(1000);
  const traces = e.tracer.recent().map((s) => e.tracer.get(s.rootId)!);
  const hit = traces.find((trace) => trace.steps.some((s) => s.cache?.outcome === "hit"))!;
  expect(hit).toBeDefined();
  const step = hit.steps.find((s) => s.cache)!;
  expect(cacheTraceWords(step.cache!, step.node!, d)).toContain("Hit at Edge cache");
  expect(
    buildScript({
      trace: hit,
      diagram: d,
      roleOf: (id) => stencilRole(d.nodes.find((n) => n.id === id)!.stencil),
      edgeLength: () => 200,
    }).beats.some((b) => b.caption?.includes("Hit at Edge cache")),
  ).toBe(true);
  expect(
    e
      .snapshot()
      .events.some((event) => event.cache && cacheTraceWords(event.cache, event.nodeId, d).includes("at Edge cache")),
  ).toBe(true);
});

it("derives Inputs rows from current traffic rather than an editable hit ratio", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: [
      {
        id: "pages",
        label: "Pages",
        match: { types: ["*"] },
        policy: { ttlMs: 300_000, keys: 50_000, popularity: "typical" },
      },
    ],
  };
  const read = () =>
    explainNode(d, "cache", { includeCache: true, fixes: false, analysis: analyzeCapacity(d) })!.cache![0];
  const before = read();
  d.nodes[0].props!.ratePerSec = 1000;
  const after = read();
  expect(after.rate).toBe(5 * before.rate);
  expect(after.hitRatio).toBeGreaterThan(before.hitRatio);
});
