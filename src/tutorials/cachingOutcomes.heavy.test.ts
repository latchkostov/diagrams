import "../sim/cache/cacheRuntime";
import { expect, it } from "vitest";
import { LiveController, type LiveState } from "../live/controller";
import { herdThreshold } from "../live/cacheHerd";
import { TroubleTracker } from "../live/troubleTracker";
import { confirmedCacheFix } from "../live/cacheFixPlan";
import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import stampede from "../examples/cache-stampede.json";
import { cachingPractice, coldCachePractice } from "../lab/cachingPractice";
import { configuredPlanning } from "../planning/cache";
import { resolveSubjects } from "./checks";
import { cacheStampede } from "./catalog/cacheStampede";
import { cdnCache } from "./catalog/cdnCache";
import { staleWhileRevalidate } from "./catalog/staleWhileRevalidate";
import { patchProps } from "./paths";

const seeds = [7, 17, 42, 101, 2026];

it.each(seeds)("the observed stampede offers the lesson's one-fetch action (seed %i)", async (seed) => {
  const d = structuredClone(stampede) as DiagramFile;
  const c = new LiveController(d);
  c.selectSimulation({ ...d.simulations![0], seed });
  const tracker = new TroubleTracker(
    c,
    async (request) => {
      if (request.trouble.action.kind !== "cache") return;
      return confirmedCacheFix({
        context: request.context,
        node: request.trouble.action.node,
        rule: request.trouble.action.rule,
        item: request.trouble.action.item,
        edge: request.trouble.action.edge,
        time: request.time,
      });
    },
    () => {},
  );
  const stop = tracker.subscribe(() => {});
  let action = tracker.current()?.action;
  try {
    c.setPlaying(true);
    for (let at = 0; at < 18000 && action?.kind !== "cache"; at += 100) {
      c.advance(100);
      c.publish();
      await Promise.resolve();
      action = tracker.current()?.action;
    }
    expect(action).toMatchObject({ kind: "cache", step: "coalesce" });
  } finally {
    stop();
    c.dispose();
  }
});

function play(d: DiagramFile, seed: number, run: string, duration: number, observe?: (state: LiveState) => void) {
  const c = new LiveController(d);
  const sim = { ...d.simulations!.find((s) => s.id === run)!, seed };
  expect(c.selectSimulation(sim), c.getState().resourceError).toBe("selected");
  if (!sim.traffic.length) c.setTraffic(true);
  c.setPlaying(true);
  for (let at = 0; at < duration; at += 100) {
    c.advance(100);
    if (observe) {
      c.publish();
      observe(c.getState());
    }
  }
  c.publish();
  const state = c.getState();
  c.dispose();
  return state;
}

it.each(seeds)("cache introduction, demand, TTL, tail and stale outcomes are deterministic (seed %i)", (seed) => {
  const d = cachingPractice();
  const intro = cachingPractice(false);
  const rule = cdnCache.steps[1].demo[0];
  if (rule.kind !== "patch") throw new Error("Expected rule repair");
  intro.nodes[1].props = { ...intro.nodes[1].props, ...patchProps(intro.nodes[1].props, rule.patches) };
  const s = resolveSubjects(cdnCache, d);
  const state = play(intro, seed, "cache-traffic", 10000);
  const edge = state.snapshot.nodes[s.edge!];
  expect(edge.cache!.hitRatio).toBeGreaterThan(0.5);
  expect(state.snapshot.nodes[s.origin!].processed).toBeLessThan(edge.processed);
  const c = new LiveController(d);
  try {
    c.selectSimulation(d.simulations![0]);
    const expected = () =>
      configuredPlanning(c.currentDiagram, c.getState())!.analysis.cacheDemand!.edge.products.hitRatio;
    const highDemand = expected();
    c.setInputs({ ...c.getState().inputs, traffic: 0.2 });
    const lowDemand = expected();
    expect(lowDemand).toBeLessThan(highDemand);
    const longer = structuredClone(d);
    (longer.nodes[1].props!.cache as CacheTable).rules[0].policy.ttlMs = 60000;
    c.updateDiagram(longer);
    expect(expected()).toBeGreaterThan(highDemand);
  } finally {
    c.dispose();
  }

  const tail = cachingPractice();
  tail.nodes[0].props!.ratePerSec = 40;
  tail.simulations![0].traffic[0].shape = { kind: "constant", ratePerSec: 40, durationMs: 600000 };
  const withCache = play(tail, seed, "cache-traffic", 10000);
  expect(withCache.snapshot.nodes.edge.cache!.hitRatio).toBeGreaterThan(0.5);
  expect(withCache.snapshot.nodes.edge.cache!.hitRatio).toBeLessThan(0.95);
  expect(withCache.snapshot.nodes.readers.latency!.p95).toBeGreaterThanOrEqual(100);
  (tail.nodes[1].props!.cache as CacheTable).rules[0].policy = { noStore: true };
  const withoutCache = play(tail, seed, "cache-traffic", 10000);
  expect(withoutCache.snapshot.nodes.readers.latency!.p95).toBeGreaterThanOrEqual(100);
  expect(withoutCache.snapshot.nodes.edge.cache!.originOffload).toBe(0);

  if (typeof staleWhileRevalidate.start !== "function") throw new Error("Expected local practice");
  const stale = staleWhileRevalidate.start();
  const before = play(stale, seed, "cache-traffic", 10000);
  expect(before.snapshot.nodes.edge.cache!.hitRatio).toBeLessThanOrEqual(0.99);
  (stale.nodes[1].props!.cache as CacheTable).rules[0].policy.staleWhileRevalidateMs = 10000;
  const after = play(stale, seed, "cache-traffic", 10000);
  expect(after.snapshot.nodes.edge.cache!.misses).toBe(0);
  expect(after.snapshot.nodes.edge.cache!.hitRatio).toBeGreaterThanOrEqual(0.999);
  expect(after.snapshot.nodes.edge.cache!.staleHits).toBeGreaterThan(0);
  expect(after.snapshot.nodes.edge.cacheDetails!.itemFetches).toBeLessThanOrEqual(1);
});

// 4242 and 1005 once started the hot item absent: a cold fill no stale window could serve.
it.each([...seeds, 4242, 1005])(
  "the stampede lesson's 20 s cut keeps its herd and replay outcomes; a stale window starts warm (seed %i)",
  (seed) => {
    if (typeof cacheStampede.start !== "function") throw new Error("Expected the lesson's cut");
    const d = cacheStampede.start();
    for (const id of ["ttl-only", "one-fetch", "serve-stale"])
      expect(d.simulations!.find((s) => s.id === id)!.durationMs).toBe(20000);
    let herd = 0;
    const bad = play(d, seed, "ttl-only", 20000, (state) => {
      herd = Math.max(herd, state.snapshot.nodes.cdn.cacheDetails?.itemFetches ?? 0);
    });
    expect(herd).toBeGreaterThanOrEqual(herdThreshold(1));
    expect(bad.run!.expectations.map((e) => e.status)).toEqual(["fail", "fail", "fail"]);
    for (const id of ["one-fetch", "serve-stale"]) {
      const fixed = play(d, seed, id, 20000);
      expect(fixed.run!.done, id).toBe(true);
      expect(
        fixed.run!.expectations.map((e) => e.status),
        id,
      ).toEqual(["pass", "pass", "pass"]);
    }

    if (typeof staleWhileRevalidate.start !== "function") throw new Error("Expected local practice");
    const stale = staleWhileRevalidate.start();
    (stale.nodes[1].props!.cache as CacheTable).rules[0].policy.staleWhileRevalidateMs = 10000;
    const refresh = play(stale, seed, "cache-traffic", 5000);
    expect(refresh.snapshot.nodes.edge.cache!.misses).toBe(0);
    expect(refresh.snapshot.nodes.edge.cache!.hitRatio).toBeGreaterThanOrEqual(0.999);
  },
);

it.each(seeds)(
  "the example's herd, fixed replay, hard surge and soft purge satisfy lesson outcomes (seed %i)",
  (seed) => {
    const d = structuredClone(stampede) as DiagramFile;
    let herd = 0;
    const bad = play(d, seed, "ttl-only", 40000, (state) => {
      herd = Math.max(herd, state.snapshot.nodes.cdn.cacheDetails?.itemFetches ?? 0);
    });
    expect(herd).toBeGreaterThanOrEqual(herdThreshold(1));
    expect(bad.run!.expectations.find((e) => e.id === "fetches")!.status).toBe("fail");
    const fixed = play(d, seed, "one-fetch", 40000);
    expect(fixed.run!.expectations.map((e) => e.status)).toEqual(["pass", "pass", "pass"]);
    const purge = coldCachePractice();
    for (const mode of ["hard", "soft"] as const) {
      purge.simulations = [
        {
          id: "deploy",
          title: purge.title,
          seed,
          scale: 1,
          durationMs: 10000,
          traffic: [],
          timeline: [
            { atMs: 0, action: { do: "fault", drill: "cold-cache", fault: { kind: "purge", node: "cdn", mode } } },
          ],
        },
      ];
      const result = play(purge, seed, "deploy", 9000);
      const backlog = result.snapshot.nodes.origin.backlog;
      if (mode === "hard") expect(backlog).toBeGreaterThanOrEqual(50);
      else expect(backlog).toBeLessThan(50);
      expect(result.snapshot.nodes.cdn.processed).toBeGreaterThanOrEqual(1000);
    }
  },
);
