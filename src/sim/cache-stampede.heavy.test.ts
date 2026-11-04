import { expect, it } from "vitest";
import example from "../examples/cache-stampede.json";
import type { DiagramFile } from "../model/types";
import { createSimulationRun } from "./simulation";
import "./cache/cacheRuntime";
import { runEndResult } from "../live/runEndResult";
import type { LiveState } from "../live/controller";

it("purge narration explains the minutes-long refill and labels the maximum-item metric honestly", () => {
  const d = example as DiagramFile;
  expect(d.description).toContain("refilling 20,000 other products takes minutes");
  expect(
    d.simulations![3].timeline!.some((s) => s.action.do === "note" && s.action.text.includes("takes minutes")),
  ).toBe(true);
  for (const sim of d.simulations!)
    expect(sim.expectations!.find((e) => "node" in e.metric && e.metric.field === "itemFetches")!.label).toBe(
      "Most fetches in flight for one item < 5, always",
    );
});

it.each([1, 7, 17, 42, 99])("TTL herds grow; one fetch per item passes every unchanged chip (seed %s)", (seed) => {
  const d = example as DiagramFile;
  const results = d.simulations!.map((sim) => {
    const run = createSimulationRun(d, { ...sim, seed }, { maxParticles: 0 });
    let maxFetches = 0,
      maxBacklog = 0,
      cycle = 0;
    const peaks: number[] = [];
    while (!run.state().done) {
      if (run.state().waiting) run.resume();
      run.step(10);
      const s = run.engine.snapshot(),
        herd = s.nodes.cdn.cacheDetails?.herd;
      const fetches = herd?.rule === "launch" ? herd.fetches : 0;
      maxFetches = Math.max(maxFetches, fetches);
      maxBacklog = Math.max(maxBacklog, s.nodes.origin.backlog);
      if (fetches) cycle = Math.max(cycle, fetches);
      else if (cycle) {
        peaks.push(cycle);
        cycle = 0;
      }
    }
    if (cycle) peaks.push(cycle);
    return {
      maxFetches,
      maxBacklog,
      endBacklog: run.engine.snapshot().nodes.origin.backlog,
      peaks,
      p95: run.engine.snapshot().nodes.shoppers.latency!.p95,
      expectations: run.state().expectations.map((e) => e.status),
      fetches: run.engine.snapshot().nodes.cdn.cache!.fetches,
      staleHits: run.engine.snapshot().nodes.cdn.cache!.staleHits ?? 0,
      revalidations: run.engine.snapshot().nodes.cdn.cache!.revalidations ?? 0,
      lesson: runEndResult({ run: run.state(), running: sim, snapshot: run.engine.snapshot() } as LiveState, d),
    };
  });
  expect(results[0].expectations).toEqual(["fail", "fail", "fail"]);
  expect(results[0].peaks[0]).toBeGreaterThanOrEqual(60);
  expect(results[0].peaks[0]).toBeLessThan(75);
  expect(results[0].maxFetches).toBeGreaterThan(2 * results[0].peaks[0]);
  expect(results[0].maxBacklog).toBeGreaterThan(1000);
  expect(results[0].p95).toBeGreaterThan(1000);
  expect(results[1].maxFetches).toBe(1);
  expect(results[1].maxBacklog).toBeLessThan(10);
  expect(results[1].expectations).toEqual(["pass", "pass", "pass"]);
  expect(results[1].fetches).toBeLessThan(results[0].fetches);
  console.info("stale and purge bands", JSON.stringify({ seed, results: results.slice(2) }));
  expect(results[2].expectations).toEqual(["pass", "pass", "pass"]);
  expect(results[2].staleHits).toBeGreaterThan(0);
  expect(results[2].revalidations).toBeGreaterThan(0);
  expect(results[3].expectations.slice(0, 2)).toEqual(["fail", "fail"]);
  expect(results[3].expectations[2]).toBe(seed === 1 ? "pass" : "fail");
  expect(results[3].maxBacklog).toBeGreaterThan(50);
  expect(results[3].endBacklog).toBeGreaterThan(50);
  expect(results[3].p95).toBeGreaterThan(300);
  expect(results[3].lesson).toContain("still far behind at the end of this run");
  expect(results[3].lesson).toContain("20,000");
  expect(results[3].lesson).toContain("minutes");
  expect(results[4].expectations).toEqual(["pass", "pass", "pass"]);
  expect(results[4].maxBacklog).toBeLessThan(50);
});
