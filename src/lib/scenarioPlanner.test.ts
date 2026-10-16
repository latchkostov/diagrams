import { describe, expect, it, vi } from "vitest";
import * as simulation from "../sim/simulation";
import { planScaling, scenarioPlans } from "../sim/scalingPlanner";
import { describeDiagram } from "../ai/describe";
import { plannerFixture } from "../lab/plannerFixture";
import { offThreadPlans, registerScenarioPlanner, rememberPlans, scenarioPlanner } from "./scenarioPlanner";

describe("scenario sizing off the editor's main thread", () => {
  it("headless (nothing registered) plans where it's asked", () => {
    expect(offThreadPlans(plannerFixture())).toBeUndefined();
    expect(scenarioPlans(plannerFixture())?.[0].suggestions[0]).toMatchObject({ kind: "max", to: 14 });
  });
  it("in the editor, describing and checking read only the worker's results", async () => {
    const d = plannerFixture();
    const plans = planScaling(d);
    const worker = vi.fn(() => Promise.resolve(plans));
    registerScenarioPlanner(worker);
    const played = vi.spyOn(simulation, "createSimulationRun");
    try {
      // Not yet worked out: no sizing, and nothing played here.
      expect(scenarioPlans(structuredClone(d))).toBeUndefined();
      expect(describeDiagram(d)).not.toContain("scenario sizing");
      // The agent tool waits for the worker; then the same words Checks shows.
      await scenarioPlanner()!(d);
      expect(worker).toHaveBeenCalledTimes(1);
      expect(describeDiagram(structuredClone(d))).toContain("Raise the maximum to 14");
      // A rename the simulation sees is a different result: not reused.
      const renamed = structuredClone(d);
      renamed.nodes[1].label = "Fulfilment";
      expect(scenarioPlans(renamed)).toBeUndefined();
      // A background check's plans count too.
      rememberPlans(renamed, plans);
      expect(scenarioPlans(renamed)).toBe(plans);
      expect(played).not.toHaveBeenCalled();
    } finally {
      played.mockRestore();
      registerScenarioPlanner(undefined);
    }
  });
});
