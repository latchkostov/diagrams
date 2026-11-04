import { expect, it, vi } from "vitest";
import example from "../examples/cache-stampede.json";
import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import { cacheLadder, confirmedCacheFix, cacheRecovers, type CacheFixEvidence } from "./cacheFixPlan";
import { oneFetchPerItem } from "../sim/cachePresets";
import { createSimulationRun } from "../sim/simulation";
import { realSnapshot } from "../sim/units";
import { TroubleWatcher } from "./observedTrouble";
import * as headless from "../sim/headless";
import "../sim/cache/cacheRuntime";

const context = (seed = 7) => {
  const diagram = structuredClone(example) as DiagramFile;
  const simulation = { ...diagram.simulations![0], seed };
  return { revision: 0, origin: { diagram, simulation, initialTraffic: false }, controls: [] };
};

it("each ladder edit equals the inspector preset and the saved comparison; freshness stays fixed", () => {
  const d = example as DiagramFile,
    table = d.nodes[1].props!.cache as CacheTable;
  const steps = cacheLadder(table, "launch");
  expect(steps.map((s) => s.step)).toEqual(["coalesce"]);
  expect(steps[0].cache.rules[0].policy).toEqual(oneFetchPerItem(table.rules[0].policy));
  expect(steps[0].cache).toEqual(d.simulations![1].setup!.props!.cdn.cache);
  expect(cacheLadder(steps[0].cache, "launch")).toEqual([]);
  expect(cacheLadder(table, "missing")).toEqual([]);
  expect(cacheLadder({ rules: [], default: { noStore: true } }, "")).toEqual([]);
});

it.each([1, 7, 17, 42, 99])("confirms one fetch per item first with the same seed %s", (seed) => {
  const proven = vi.fn();
  const c = context(seed),
    run = createSimulationRun(c.origin.diagram, c.origin.simulation, { maxParticles: 0 });
  const watcher = new TroubleWatcher();
  const expiries = new Set<number>();
  let result: ReturnType<typeof confirmedCacheFix>;
  while (run.state().time < 18000) {
    run.step(10);
    if (watcher.observe(realSnapshot(run.engine.snapshot()), c.origin.diagram)[0]?.kind === "cache-stampede") {
      const expiry = run.engine.snapshot().nodes.cdn.cacheDetails!.herd!.expiredAt;
      if (expiries.has(expiry)) continue;
      expiries.add(expiry);
      result = confirmedCacheFix({ context: c, node: "cdn", rule: "launch", time: run.state().time, proven });
      if (result) break;
    }
  }
  expect(result!).toMatchObject({ kind: "cache", step: "coalesce" });
  expect(proven).toHaveBeenCalledOnce();
});

it("requires two observed expiries and every recovery band, not one lucky sample", () => {
  const before: CacheFixEvidence = {
    preBacklog: 2,
    preP95: 250,
    threads: 4,
    maxFetches: 60,
    maxBacklog: 100,
    maxP95: 2000,
    expiries: 3,
    herd: true,
  };
  const after = { ...before, maxFetches: 1, maxBacklog: 6, maxP95: 300, expiries: 2 };
  expect(cacheRecovers(before, after)).toBe(true);
  for (const patch of [{ maxFetches: 2 }, { maxBacklog: 7 }, { maxP95: 301 }, { expiries: 1 }])
    expect(cacheRecovers(before, { ...after, ...patch })).toBe(false);
  expect(cacheRecovers({ ...before, herd: false }, after)).toBe(false);
});

it("verifies the requested item independently of another overlapping item's display summary", () => {
  const create = headless.createHeadlessRun;
  const spy = vi.spyOn(headless, "createHeadlessRun").mockImplementation((...args) => {
    const run = create(...args);
    const snapshot = run.engine.snapshot;
    run.engine.snapshot = () => {
      const s = snapshot();
      const details = s.nodes.cdn.cacheDetails;
      if (details?.herd) details.herd = { ...details.herd, rule: "products", item: 2 };
      return s;
    };
    return run;
  });
  try {
    const proven = vi.fn();
    expect(confirmedCacheFix({ context: context(), node: "cdn", rule: "launch", time: 6000, proven })).toMatchObject({
      kind: "cache",
      rule: "launch",
      step: "coalesce",
    });
    expect(proven).toHaveBeenCalledOnce();
    expect(proven.mock.calls[0][1]).toMatchObject({ maxFetches: 1 });
    expect(proven.mock.calls[0][1].expiries).toBeGreaterThanOrEqual(2);
  } finally {
    spy.mockRestore();
  }
});

it("offers no unconfirmed fix for refused, incomplete, over-budget or too-short replays", () => {
  const c = context();
  expect(
    confirmedCacheFix({
      context: c,
      node: "cdn",
      rule: "launch",
      time: 6000,
      budget: { work: 0, messages: { remaining: 100000 } },
    }),
  ).toBeUndefined();
  expect(
    confirmedCacheFix({
      context: c,
      node: "cdn",
      rule: "launch",
      time: 6000,
      budget: { work: 2000000, messages: { remaining: 0 } },
    }),
  ).toBeUndefined();
  expect(confirmedCacheFix({ context: c, node: "cdn", rule: "launch", time: 39000 })).toBeUndefined();
  const spy = vi.spyOn(headless, "createHeadlessRun").mockImplementation(() => {
    throw new Error("refused");
  });
  try {
    expect(confirmedCacheFix({ context: c, node: "cdn", rule: "launch", time: 6000 })).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it("detects a herd and its rising origin ahead of thread trouble; a held herd is quiet", () => {
  const c = context(),
    run = createSimulationRun(c.origin.diagram, c.origin.simulation, { maxParticles: 0 });
  const watcher = new TroubleWatcher();
  let seen = false;
  for (let tick = 0; tick < 1800; tick++) {
    run.step(10);
    const trouble = watcher.observe(realSnapshot(run.engine.snapshot()), c.origin.diagram);
    if (trouble[0]?.kind === "cache-stampede") {
      seen = true;
      break;
    }
  }
  expect(seen).toBe(true);
  const fixed = c.origin.diagram.simulations![1];
  const second = createSimulationRun(c.origin.diagram, fixed, { maxParticles: 0 });
  watcher.reset();
  for (let tick = 0; tick < 1000; tick++) {
    second.step(10);
    expect(
      watcher
        .observe(realSnapshot(second.engine.snapshot()), c.origin.diagram)
        .some((t) => t.kind === "cache-stampede"),
    ).toBe(false);
  }
});
