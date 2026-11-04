import { expect, it } from "vitest";
import example from "../examples/cache-stampede.json";
import type { DiagramFile } from "../model/types";
import { createSimulationRun } from "./simulation";
import "./cache/cacheRuntime";

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
  expect(results[3].expectations).toEqual(["fail", "pass", "pass"]);
  expect(results[3].maxBacklog).toBeGreaterThan(50);
  expect(results[4].expectations).toEqual(["pass", "pass", "pass"]);
  expect(results[4].maxBacklog).toBeLessThan(50);
});
