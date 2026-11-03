import { watchCheckpoints } from "../test/checkpointProbe";
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { cacheRuntime } from "./cache/cacheRuntime";
import * as math from "./cache/cacheMath";
import * as topology from "./topology";
import { analyzeCapacity } from "./capacity";
import { explainNode } from "../planning/explanation";
import { configuredPlanning } from "../planning/cache";
import { CacheDerivations } from "../planning/CacheDerivations";
import { nodeSummary, dockedNodeVitals } from "../live/hoverSummary";
import { cacheReadout } from "../live/cacheReadout";
import { latencyDuration } from "../live/latencyFormat";

it("explains simulation-overridden rules and a simulation-only Default policy", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [{ id: "pages", match: { types: ["Page"] }, policy: { ttlMs: 300_000 } }] };
  const sim = {
    id: "override",
    title: "Override",
    traffic: [],
    setup: {
      props: {
        cache: {
          cache: {
            rules: [{ id: "pages", match: { types: ["Page"] }, policy: { ttlMs: 3_600_000 } }],
            default: { ttlMs: 60_000, keys: 1 },
          },
        },
      },
    },
  };
  const analysis = analyzeCapacity(d, sim);
  const rows = explainNode(d, "cache", { sim, analysis, includeCache: true, fixes: false })!.cache!;
  expect(rows.map((r) => [r.id, r.policy.ttlMs])).toEqual([
    ["pages", 3_600_000],
    ["", 60_000],
  ]);
  for (const row of rows) expect(row.hitRatio).toBe(analysis.cacheDemand!.cache[row.id]?.hitRatio ?? 0);
  delete d.nodes[1].props!.cache;
  expect(explainNode(d, "cache", { sim, includeCache: true, fixes: false })!.cache).toEqual(rows);
});

it("counts slow no-store replies in the one response p95 used by metrics, hover, dock and badges", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: [{ id: "pages", match: { types: ["Page"] }, policy: { ttlMs: 60_000, keys: 1 } }],
    default: { noStore: true },
  };
  d.nodes[2].props!.latencyMs = 500;
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.inject("source", 1, { type: "Page" });
  e.step(1000);
  e.inject("source", 90, { type: "Page", spreadMs: 1000 });
  e.inject("source", 10, { type: "Order", spreadMs: 1000 });
  e.step(2000);
  const s = e.snapshot().nodes.cache;
  const latency = s.cacheDetails!.latency!;
  expect(s.cache).toMatchObject({ hits: 90, misses: 1, notCached: 10 });
  expect(latency.total!.samples).toBe(101);
  expect(latency.hit!.samples).toBe(90);
  expect(latency.miss!.samples).toBe(1);
  expect(Object.keys(latency.total!.byType)).toEqual(["miss", "hit"]);
  expect(latency.total!.p95).toBeGreaterThanOrEqual(500);
  expect(e.measure({ node: "cache", field: "p95" })).toBe(latency.total!.p95);
  expect(s.latency).toEqual(latency.total);
  const formatted = latencyDuration(latency.total!.p95);
  expect(dockedNodeVitals(s).find((f) => f.key === "latency")!.value).toBe(formatted);
  expect(nodeSummary(s, []).sections.find((section) => section.key === "latency")!.summary).toBe(formatted);
  const token = e.checkpoint();
  const suffix = () => {
    e.inject("source", 10, { type: "Order" });
    e.step(1000);
    return e.snapshot();
  };
  const expected = suffix();
  e.restore(token);
  expect(suffix()).toEqual(expected);
});

it("refreshes the warming baseline after Traffic changes while preserving warm contents and replay", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 1000, keys: 100, popularity: "even" } };
  const sim = {
    id: "warming",
    title: "Warming",
    traffic: [
      { id: "readers", node: "source", shape: { kind: "constant" as const, ratePerSec: 1000, durationMs: 100_000 } },
    ],
  };
  const run = createSimulationRun(d, sim);
  run.step(1000);
  const before = run.engine.snapshot().nodes.cache;
  const watch = watchCheckpoints();
  run.engine.checkpoint();
  const cache = watch.sources[0][0].get("cache")!.cache!;
  const fresh = cache.rules[0].freshUntil.slice();
  const stream = cache.rules[0].stream;
  watch.stop();
  run.setMultipliers({ traffic: 0.01 });
  const after = run.engine.snapshot().nodes.cache;
  expect(after.cache).toEqual(before.cache);
  expect(cache.rules[0].freshUntil).toEqual(fresh);
  expect(cache.rules[0].stream).toBe(stream);
  const expected = analyzeCapacity(d, { ...sim, multipliers: { traffic: 0.01 } }).cacheDemand!.cache[""].hitRatio;
  expect(after.cacheDetails!.expected).toBe(expected);
  expect(expected).toBeLessThan(before.cacheDetails!.expected! / 2);
  const token = run.checkpoint();
  const suffix = () => {
    run.step(15_000);
    return run.engine.snapshot();
  };
  const result = suffix();
  expect(cacheReadout(result.nodes.cache)?.warming).toBe(false);
  run.restore(token);
  expect(suffix()).toEqual(result);
});

it("computes expected hit shares only when configuration changes, including after restore", () => {
  const d = cacheFixture();
  const e = createEngine({ seed: 7 });
  e.load(d, cacheRuntime.plan(d));
  const share = vi.spyOn(math, "cacheHitShare");
  try {
    const expected = e.snapshot().nodes.cache.cacheDetails!.expected;
    const token = e.checkpoint();
    for (let i = 0; i < 8; i++) {
      expect(e.frame().nodes.cache.cacheDetails!.expected).toBe(expected);
      e.measure({ node: "cache", field: "hitRatio" });
      e.restore(token);
    }
    expect(share).not.toHaveBeenCalled();
  } finally {
    share.mockRestore();
  }
});

it("reuses cache derivations and compiled topology across Inputs and Properties renders", () => {
  const d = cacheFixture();
  d.title = "Cached cache derivations";
  const configured = configuredPlanning(d)!;
  const row = configured.cacheExplanation("cache");
  const compile = vi.spyOn(topology, "compileTopology");
  try {
    for (let i = 0; i < 8; i++) {
      expect(configuredPlanning(structuredClone(d))).toBe(configured);
      expect(configured.cacheExplanation("cache")).toBe(row);
      expect(
        renderToStaticMarkup(createElement(CacheDerivations, { diagram: d, id: i % 2 ? "cache" : undefined })),
      ).toContain("cache-derivation-cache-");
    }
    expect(compile).not.toHaveBeenCalled();
  } finally {
    compile.mockRestore();
  }
});
