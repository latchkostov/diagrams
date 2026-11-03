import { expect, it } from "vitest";
import current from "../examples/black-friday-commerce.json";
import frozen from "../../tests/parity/fixtures/black-friday-commerce-a1.json";
import type { DiagramFile } from "../model/types";
import { analyzeCapacity } from "./capacity";
import { planningSimulation } from "./capacityPlanning";
import { createSimulationRun } from "./simulation";
import "./cache/cacheRuntime";
import { runChecks } from "../checks/run";
import { collectEvidence } from "../checks/evidence";
import { withEvidence } from "../checks/evidenceMerge";

const d = current as DiagramFile;
it("keeps the upgraded showcase clean in configured Checks and simulation evidence", () => {
  const configured = runChecks(d);
  expect(configured.findings).toEqual([]);
  const evidence = collectEvidence(d, { now: () => 0 });
  expect(evidence.played.map((s) => s.id)).toEqual(d.simulations!.map((s) => s.id));
  expect(withEvidence(configured, evidence, d.checks).result.findings).toEqual([]);
  for (const simulation of d.simulations!)
    expect(simulation.expectations).toEqual(frozen.simulations.find((s) => s.id === simulation.id)!.expectations);
});
it("keeps the released A1 example frozen and measures the edge's warm peak and cold peak", () => {
  expect(frozen.planning.revision).toBe("p3-a1");
  const peak = planningSimulation(d, d.simulations![0]);
  const warm = analyzeCapacity(d, peak);
  const cold = structuredClone(d);
  delete cold.nodes.find((n) => n.id === "cdn")!.props!.cache;
  const noCache = analyzeCapacity(cold, peak);
  for (const id of ["catalog-bff", "search-api"]) {
    expect(warm.nodes[id].utilization).toBeGreaterThanOrEqual(0.5);
    expect(warm.nodes[id].utilization).toBeLessThanOrEqual(0.7);
    expect(noCache.nodes[id].utilization).toBeGreaterThan(1.5);
  }
  expect(warm.cacheDemand?.cdn.products.hitRatio).toBeGreaterThan(0.8);
});
it.each(d.simulations!)("keeps the lesson's expectations in $id", (simulation) => {
  const run = createSimulationRun(d, simulation);
  for (let tick = 0; tick < 6000 && !run.state().done; tick++) {
    if (run.state().waiting) run.resume();
    run.step(100);
  }

  expect(run.state().done).toBe(true);
  expect(run.state().expectations.every((e) => e.status === "pass")).toBe(true);
});
