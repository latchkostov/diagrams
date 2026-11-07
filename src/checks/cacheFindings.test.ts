import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import small from "../examples/cache-stampede.json";
import blackFriday from "../examples/black-friday-commerce.json";
import { cacheFixture } from "../lab/cacheFixture";
import { cacheAsideFixture } from "../lab/cacheAsideFixture";
import { analyzeCapacity } from "../sim/capacity";
import { buildContext } from "./context";
import { computeCacheFindings, cacheRules, CACHE_RULES } from "./cacheFindings";
import { runChecks, onlyRules, summarize } from "./run";
import { agentReport, OUTPUT_BUDGET } from "./report";
import { applyOps } from "../ai/ops";
import * as probes from "./cacheProbe";
import * as threadFix from "../live/threadFixPlan";
import { presentCacheFinding } from "./cachePresentation";
import * as headless from "../sim/headless";
import { probeCache, coldCacheSimulation, cacheWork } from "./cacheProbe";

it.each(["read-through", "cache-aside"])("sizes a fractional %s origin from its connection share", (kind) => {
  const d = kind === "read-through" ? cacheFixture() : cacheAsideFixture();
  const cache = d.nodes.find((n) => n.id === "cache")!;
  if (kind === "read-through") cache.stencil = "generic.cache";
  cache.props!.cache = { rules: [], default: { ttlMs: 1000, keys: 1000, popularity: "even" } };
  const fetch = d.edges.find((e) => e.id === "fetch")!;
  fetch.props!.share = 0.1;
  const origin = d.nodes.find((n) => n.id === fetch.to)!;
  origin.stencil = "generic.service";
  origin.props = { latencyMs: 100, concurrency: 1, replicas: 1, jitter: 0 };
  const analysis = analyzeCapacity(d);
  expect.soft(analysis.cacheDemand!.cache[""].origins![origin.id].rate).toBeCloseTo(20);
  const cold = structuredClone(d);
  cold.nodes.find((n) => n.id === "cache")!.props!.cache = { rules: [], default: { noStore: true } };
  expect(analyzeCapacity(cold).connections.fetch).toBeCloseTo(20);
  const finding = runChecks(d, { rules: ["cache-cold-start"] }).findings[0];
  expect.soft(finding?.cacheFinding).toMatchObject({ origin: origin.id, coldPerSec: 20, capacityPerSec: 10 });
  expect.soft(finding?.fix?.cacheLabel).toEqual({ kind: "replicas", value: 4 });
  expect(finding?.fix?.ops).toContainEqual({ op: "update", target: origin.id, props: { replicas: 4 } });
});

it("scopes a shared cache's cold-start warning and replica sizing to the failing caller's own origin", () => {
  // Two services share one cache, request type and address: their lookups merge into one traffic class.
  const d = cacheAsideFixture();
  d.nodes.find((n) => n.id === "source")!.props!.ratePerSec = 300;
  d.nodes.find((n) => n.id === "service")!.props!.concurrency = 1000;
  d.nodes.find((n) => n.id === "database")!.props!.latencyMs = 1;
  d.nodes.find((n) => n.id === "cache")!.props!.cache = {
    rules: [],
    default: { ttlMs: 600000, keys: 10000, popularity: "even" },
  };
  d.nodes.push(
    { id: "other-readers", stencil: "client.browser", label: "Other readers", x: 0, y: 400, props: { ratePerSec: 30 } },
    {
      id: "other-service",
      stencil: "generic.service",
      label: "Reviews",
      x: 280,
      y: 400,
      props: { latencyMs: 10, jitter: 0, concurrency: 1000, failureRate: 0 },
    },
    {
      id: "other-database",
      stencil: "generic.service",
      label: "Reviews database",
      x: 560,
      y: 400,
      props: { latencyMs: 100, concurrency: 1, replicas: 1, jitter: 0 },
    },
  );
  d.edges.push(
    { id: "other-input", from: "other-readers", to: "other-service", kind: "sync", props: { travelMs: 10 } },
    {
      id: "other-lookup",
      from: "other-service",
      to: "cache",
      kind: "sync",
      props: { travelMs: 10, caller: { wait: "blocking" } },
    },
    {
      id: "other-fetch",
      from: "other-service",
      to: "other-database",
      kind: "sync",
      props: { travelMs: 10, caller: { wait: "blocking", onMiss: "other-lookup" } },
    },
  );
  const origins = analyzeCapacity(d).cacheDemand!.cache[""].origins!;
  expect.soft(origins.database.rate).toBeCloseTo(300);
  expect.soft(origins["other-database"].rate).toBeCloseTo(30);
  const findings = runChecks(d, { rules: ["cache-cold-start"] }).findings.filter((f) => f.cacheFinding);
  expect(findings.map((f) => f.cacheFinding?.origin)).toEqual(["other-database"]);
  expect.soft(findings[0].cacheFinding).toMatchObject({ coldPerSec: 30, capacityPerSec: 10 });
  expect.soft(findings[0].message).toContain("gets 30/s, 3.0×");
  expect.soft(findings[0].fix?.cacheLabel).toEqual({ kind: "replicas", value: 6 });
  expect(findings[0].fix?.ops).toContainEqual({ op: "update", target: "other-database", props: { replicas: 6 } });
});

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
  const findings = computeCacheFindings(ctx);
  expect(findings.filter((f) => !f.unchecked && !f.omitted)).toEqual([]);
  expect(findings.filter((f) => f.unchecked)).toEqual([]);
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
  expect(f.fix?.label).toBe("Delete this cache rule");
  expect(presentCacheFinding(f).fix?.label).toBe("Delete this cache rule");
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
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 1000, keys: 1 } };
  d.nodes[2].props = { latencyMs: 1000, concurrency: 1, replicas: 1 };
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

it("replaces generic capacity on the cache origin before choosing another overloaded service", () => {
  const d = structuredClone(small) as DiagramFile;
  d.nodes.find((n) => n.id === "origin")!.props!.concurrency = 1;
  d.nodes.push(
    { id: "other-source", stencil: "client.browser", label: "Other readers", x: 0, y: 600, props: { ratePerSec: 2 } },
    {
      id: "other",
      stencil: "generic.service",
      label: "Other service",
      x: 600,
      y: 600,
      props: { latencyMs: 1000, concurrency: 1, replicas: 1, jitter: 0 },
    },
  );
  d.edges.push({ id: "other-request", from: "other-source", to: "other", kind: "sync" });
  const all = runChecks(d, { rules: ["capacity", "cache-stampede"] });
  expect(all.findings.some((f) => f.rule === "cache-stampede")).toBe(true);
  expect(all.findings.find((f) => f.rule === "capacity")?.target).toBe("other");
  expect(runChecks(d, { rules: ["capacity"] }).findings.find((f) => f.rule === "capacity")?.target).toBe("origin");
});

it("honours node-scoped ignores for per-rule findings, and preserves probe omissions in a cold-only check", () => {
  const d = structuredClone(small) as DiagramFile;
  d.checks = { ignore: [{ rule: "cache-stampede", target: "cdn" }] };
  const result = runChecks(d, { rules: CACHE_RULES });
  expect(result.ignored.map((f) => f.id)).toEqual(["cache-stampede:cdn:launch"]);
  expect(result.findings.some((f) => f.rule === "cache-stampede")).toBe(false);
  const spy = vi.spyOn(headless, "createHeadlessRun").mockImplementation(() => {
    throw new Error("refused");
  });
  try {
    const next = structuredClone(small) as DiagramFile;
    next.title = "A refused cold-only probe";
    expect(
      runChecks(next, { rules: ["cache-cold-start"], requests: computeCacheFindings(buildContext(next)) }).notChecked,
    ).toEqual({ cache: 1 });
  } finally {
    spy.mockRestore();
  }
});

it.each([{ rules: CACHE_RULES }, { rules: ["cache-stampede"] as const }])(
  "checks every disjoint rule after a cold-start finding (%j)",
  ({ rules }) => {
    const d = structuredClone(small) as DiagramFile;
    (d.nodes.find((n) => n.id === "cdn")!.props!.cache as CacheTable).rules.reverse();
    const findings = runChecks(d, { rules }).findings;
    expect(findings.filter((f) => f.rule === "cache-stampede").map((f) => f.cacheFinding?.rule)).toEqual(["launch"]);
    expect(findings.filter((f) => f.rule === "cache-cold-start").length).toBeLessThanOrEqual(1);
  },
);

function twoOrigins() {
  const d = structuredClone(small) as DiagramFile;
  const source = d.nodes.find((n) => n.id === "shoppers")!;
  d.planning!.requestRoutes!.push({ id: "static-route", label: "Static", address: { method: "GET", path: "/static" } });
  source.props!.trafficMix = {
    mode: "shares",
    entries: [
      { routeId: "launch", share: 0.79 },
      { routeId: "products", share: 0.2 },
      { routeId: "static-route", share: 0.01 },
    ],
  };
  (d.nodes.find((n) => n.id === "cdn")!.props!.cache as CacheTable).rules.push({
    id: "static-rule",
    label: "Static",
    match: { path: { kind: "exact", value: "/static" } },
    policy: { ttlMs: 300000, keys: 1 },
  });
  d.nodes.push(
    {
      id: "static",
      stencil: "generic.service",
      label: "Static origin",
      x: 660,
      y: 500,
      props: { concurrency: 1, latencyMs: 100, jitter: 0 },
    },
    { id: "direct", stencil: "client.browser", label: "Direct readers", x: 0, y: 500, props: { ratePerSec: 20 } },
  );
  d.edges.unshift({
    id: "static-fetch",
    from: "cdn",
    to: "static",
    kind: "sync",
    props: { requestFilter: { path: { kind: "exact", value: "/static" } } },
  });
  d.edges.find((e) => e.id === "fetch")!.props!.requestFilter = {
    path: { kind: "prefix", value: "/" },
    methods: ["GET"],
  };
  d.nodes.find((n) => n.id === "cdn")!.props!.routeTable = {
    rules: [
      {
        id: "static",
        match: { path: { kind: "exact", value: "/static" } },
        targets: [{ edgeId: "static-fetch", weight: 1 }],
      },
    ],
    default: { targets: [{ edgeId: "fetch", weight: 1 }] },
  };
  d.edges.push({ id: "direct-request", from: "direct", to: "static", kind: "sync" });
  return d;
}
it("keeps route demand, harm, capacity replacement and fixes on the matching origin", () => {
  const d = twoOrigins();
  const result = runChecks(d, { rules: ["capacity", ...CACHE_RULES] });
  const cache = result.findings.filter((f) => f.cacheFinding && f.severity === "warning");
  expect(cache.map((f) => f.cacheFinding?.origin)).toEqual(["origin", "origin"]);
  expect(cache[0].cacheFinding).toMatchObject({ rule: "launch", coldPerSec: 316 });
  expect(cache[1].cacheFinding).toMatchObject({ coldPerSec: 396 });
  expect(cache[1].fix?.ops?.map((op) => ("target" in op ? op.target : ""))).toEqual(["origin"]);
  expect(result.findings.find((f) => f.rule === "capacity")?.target).toBe("static");
  for (const f of cache) {
    expect(f.fix?.ops).toBeDefined();
    if (f.fix?.ops)
      expect(
        runChecks(applyOps(d, f.fix.ops).diagram, { rules: CACHE_RULES }).findings.map((next) => next.id),
      ).not.toContain(f.id);
  }
});

const shortTtl = () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [], default: { ttlMs: 100, keys: 1000, popularity: "even" } };
  return d;
};
it.each(["refused", "incomplete"])("withholds TTL fixes when confirmation is %s", (reason) => {
  const create = headless.createHeadlessRun;
  const advance = headless.advanceHeadless;
  const spy =
    reason === "refused"
      ? vi
          .spyOn(headless, "createHeadlessRun")
          .mockImplementationOnce(create)
          .mockImplementation(() => {
            throw new Error("refused");
          })
      : vi
          .spyOn(headless, "advanceHeadless")
          .mockImplementationOnce(advance)
          .mockImplementation(() => undefined);
  try {
    const finding = computeCacheFindings(buildContext(shortTtl())).find((f) => f.rule === "cache-ttl-short")!;
    expect(finding.cacheFinding?.suggestedTtlMs).toBe(500);
    expect(finding.message).toContain("If they can be");
    expect(finding.fix).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});
it("withholds TTL fixes when replay hits do not improve", () => {
  const original = probes.probeCache;
  let first: ReturnType<typeof original>;
  const spy = vi.spyOn(probes, "probeCache").mockImplementation((...args) => {
    first ??= original(...args);
    return first;
  });
  try {
    const finding = computeCacheFindings(buildContext(shortTtl())).find((f) => f.rule === "cache-ttl-short")!;
    expect(first).toBeDefined();
    expect(finding.cacheFinding?.suggestedTtlMs).toBe(500);
    expect(finding.fix).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

function shortRules() {
  const d = shortTtl();
  d.nodes[1].props!.cache = {
    rules: ["a", "b"].map((id) => ({
      id,
      label: id,
      match: { path: { kind: "exact", value: `/${id}` } },
      policy: { ttlMs: 100, keys: 1000, popularity: "even" },
    })),
  };
  d.planning!.requestRoutes = ["a", "b"].map((id) => ({ id, label: id, address: { method: "GET", path: `/${id}` } }));
  d.nodes[0].props!.trafficMix = {
    mode: "shares",
    entries: [
      { routeId: "a", share: 0.5 },
      { routeId: "b", share: 0.5 },
    ],
  };
  return d;
}
it("reuses the unchanged TTL baseline and free-play setup across short rules", () => {
  const d = shortRules();
  const setup = vi.spyOn(threadFix, "freePlaySimulation");
  const replay = vi.spyOn(probes, "probeCache");
  try {
    const findings = computeCacheFindings(buildContext(d)).filter((f) => f.rule === "cache-ttl-short");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.fix)).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(
      replay.mock.calls.filter((call) => {
        const sim = typeof call[1] === "function" ? call[1]() : call[1];
        return typeof sim !== "function" && sim.durationMs === 30000 && !sim.setup?.props?.cache?.cache;
      }),
    ).toHaveLength(1);
  } finally {
    setup.mockRestore();
    replay.mockRestore();
  }
});

it("skips replay setup for analytically healthy caches and rejects over-budget probes before setup", () => {
  const setup = vi.spyOn(threadFix, "freePlaySimulation");
  try {
    computeCacheFindings(buildContext(blackFriday as DiagramFile));
    expect(setup).not.toHaveBeenCalled();
    const d = cacheFixture();
    const lazy = vi.fn(() => coldCacheSimulation(d, "cache"));
    expect(probeCache(d, lazy, "cache", ["origin"], { work: 0, messages: { remaining: 100000 } })).toBeUndefined();
    expect(lazy).not.toHaveBeenCalled();
  } finally {
    setup.mockRestore();
  }
});

it("keeps an imported cache finding with a 2,000-character id inside the agent budget", () => {
  const d = cacheFixture();
  const id = "c".repeat(2000);
  d.nodes[1].id = id;
  d.edges[0].to = id;
  d.edges[1].from = id;
  d.nodes[1].props!.cache = {
    rules: [{ id: "writes", label: "Writes", match: { methods: ["POST"] }, policy: { ttlMs: 1000 } }],
  };
  const report = agentReport(runChecks(d, { rules: ["cache-method"] }));
  expect(JSON.stringify(report).length).toBeLessThanOrEqual(OUTPUT_BUDGET);
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0].rule).toBe("cache-method");
  expect(report.findings[0].cacheFinding).toBeUndefined();
});

it("keeps probe harm and recovery separate for healthy and overloaded origins", () => {
  const d = twoOrigins();
  d.nodes.find((n) => n.id === "direct")!.props!.ratePerSec = 0;
  d.nodes.find((n) => n.id === "shoppers")!.props!.trafficMix = {
    mode: "shares",
    entries: [
      { routeId: "launch", share: 0.8 },
      { routeId: "products", share: 0.2 },
    ],
  };
  const before = probeCache(d, coldCacheSimulation(d, "cdn"), "cdn", ["static", "origin"], cacheWork());
  expect(before?.origins.static).toMatchObject({ harmed: false, recovered: true });
  expect(before?.origins.origin).toMatchObject({ harmed: true, recovered: false });
});
it("memoizes a refused unchanged TTL baseline across rules", () => {
  const replay = vi.spyOn(headless, "createHeadlessRun").mockImplementation(() => {
    throw new Error("refused");
  });
  try {
    const findings = computeCacheFindings(buildContext(shortRules())).filter((f) => f.rule === "cache-ttl-short");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.cacheFinding?.suggestedTtlMs && !f.fix)).toBe(true);
    expect(replay).toHaveBeenCalledTimes(1);
  } finally {
    replay.mockRestore();
  }
});

it("does not read request findings while caching is dormant", () => {
  const d = cacheFixture();
  d.planning!.revision = "p3-w2";
  const read = vi.fn(() => []);
  for (const rule of cacheRules(read)) expect(rule.detect(buildContext(d))).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});
