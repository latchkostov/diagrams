import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import small from "../examples/cache-stampede.json";
import blackFriday from "../examples/black-friday-commerce.json";
import { cacheFixture } from "../lab/cacheFixture";
import { buildContext } from "./context";
import { computeCacheFindings, CACHE_RULES } from "./cacheFindings";
import { runChecks, onlyRules, summarize } from "./run";
import { agentReport } from "./report";
import { applyOps } from "../ai/ops";
import * as headless from "../sim/headless";
import { probeCache, coldCacheSimulation, cacheWork } from "./cacheProbe";

it("covers the small cache example with probe evidence and undoable fixes", () => {
  const d = structuredClone(small) as DiagramFile;
  const result = runChecks(d, { rules: CACHE_RULES });
  expect(result.findings.map((f) => f.rule)).toEqual(["cache-stampede", "cache-cold-start"]);
  for (const f of result.findings) {
    expect(f.cacheFinding?.probe).toEqual({ kind: "cold-cache", startMs: 5000, horizonMs: 20000, recovered: false });
    expect(f.fix?.ops).toBeDefined();
    if (f.fix?.ops) {
      const applied = applyOps(d, f.fix.ops);
      expect(applied.errors).toEqual([]);
      expect(runChecks(applied.diagram, { rules: CACHE_RULES }).findings.map((f) => f.id)).not.toContain(f.id);
    }
  }
  expect(result.findings[0].fix?.options?.[0].cacheLabel).toEqual({ kind: "stale" });
  expect(agentReport(result).findings[0].cacheFinding?.kind).toBe("cache-stampede");
});

it("leaves Black Friday's configured traffic clean and does not ask scenario sizing for cache checks", () => {
  const ctx = buildContext(blackFriday as DiagramFile);
  ctx.plans = () => {
    throw new Error("Caching must not grow scenario sizing");
  };
  expect(computeCacheFindings(ctx).filter((f) => !f.unchecked && !f.omitted)).toEqual([]);
});

it("removes an uncacheable method row without broadening it or changing other rules", () => {
  const d = cacheFixture();
  const table: CacheTable = {
    rules: [{ id: "writes", label: "Writes", match: { methods: ["POST", "DELETE"] }, policy: { ttlMs: 1000 } }],
    default: { noStore: true },
  };
  d.nodes[1].props!.cache = table;
  const f = runChecks(d, { rules: ["cache-method"] }).findings[0];
  expect(f.rule).toBe("cache-method");
  const applied = applyOps(d, f.fix!.ops!);
  expect(applied.ok).toBe(true);
  expect(applied.diagram.nodes[1].props!.cache).toEqual({ rules: [], default: { noStore: true } });
  expect(runChecks(applied.diagram, { rules: ["cache-method"] }).findings).toEqual([]);
});

it("offers the shortest doubling lifetime only after a successful 30 s replay", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 1000, popularity: "even" } };
  const f = runChecks(d, { rules: ["cache-ttl-short"] }).findings[0];
  expect(f.cacheFinding).toMatchObject({ suggestedTtlMs: 500 });
  expect(f.fix?.cacheLabel).toEqual({ kind: "ttl", value: 0.5 });
  expect(applyOps(d, f.fix!.ops!).ok).toBe(true);
});

it("bounds probes to three, reports refusal and preserves omissions in filtered and agent results", () => {
  const d = cacheFixture();
  for (let i = 1; i < 5; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}`, x: 320, y: i * 250 });
    d.edges.push(
      { id: `input${i}`, from: "source", to: `cache${i}`, kind: "sync" },
      { id: `fetch${i}`, from: `cache${i}`, to: "origin", kind: "sync" },
    );
  }
  const spy = vi.spyOn(headless, "createHeadlessRun").mockImplementation(() => {
    throw new Error("refused");
  });
  try {
    const result = runChecks(d, { rules: CACHE_RULES });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.notChecked).toEqual({ cache: 5 });
    expect(summarize(result)).not.toContain("Nothing to check");
    expect(agentReport(result).notChecked).toEqual({ cache: 5 });
    expect(onlyRules(result, ["cache-method"]).notChecked).toEqual({ cache: 5 });
    expect(onlyRules(result, ["retry-storm"]).notChecked).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it("refuses incomplete and exhausted probes without treating them as healthy", () => {
  const d = cacheFixture(),
    simulation = coldCacheSimulation(d, "cache");
  expect(probeCache(d, simulation, "cache", ["origin"], { work: 0, messages: { remaining: 100000 } })).toBeUndefined();
  expect(
    probeCache(d, simulation, "cache", ["origin"], { ...cacheWork(), messages: { remaining: 0 } }),
  ).toBeUndefined();
});

it("keeps W2 rules dormant", () => {
  const d = cacheFixture();
  d.planning!.revision = "p3-w2";
  expect(runChecks(d, { rules: CACHE_RULES }).findings).toEqual([]);
});
