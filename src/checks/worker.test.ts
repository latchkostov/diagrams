import { describe, expect, it, vi } from "vitest";
import { plannerFixture } from "../lab/plannerFixture";
import type { CheckRequest, CheckResponse } from "./worker";
import busy from "../examples/scale-on-busy-threads.json";
import type { DiagramFile } from "../model/types";

// The checks worker returns the capacity check's scenario sizing with its result, for the editor's main thread.
// A diagram with the capacity check turned off plans nothing: no saved simulation plays after an edit.

describe("checks worker", () => {
  it("keeps worker and main-thread findings identical when waiting checks are turned off and back on", async () => {
    vi.resetModules();
    const posted: CheckResponse[] = [];
    const scope = {
      onmessage: null as null | ((e: { data: CheckRequest }) => void),
      postMessage: (m: CheckResponse) => posted.push(m),
    };
    vi.stubGlobal("self", scope);
    const { registerScenarioPlanner, rememberPlans } = await import("../lib/scenarioPlanner");
    try {
      await import("./worker");
      const d = structuredClone(busy) as DiagramFile;
      d.checks = { off: ["blocked-threads", "scaling-blind"] };
      scope.onmessage!({ data: { id: 1, diagram: d } });
      const response = posted[0];
      expect("result" in response).toBe(true);
      if (!("result" in response)) throw new Error("Expected checks");
      expect(response.result.findings.map((f) => f.id)).not.toContain("blocked-threads:caller");
      expect(response.requests?.map((f) => f.id)).toContain("blocked-threads:caller");
      const { runChecks } = await import("./run");
      const normal = { ...d, checks: undefined };
      const expectedNormal = runChecks(normal);
      const { rememberRequestChecks } = await import("../lib/requestCheckCache");
      registerScenarioPlanner(async () => []);
      rememberPlans(d, response.plans!);
      rememberRequestChecks(d, response.requests!);
      expect(runChecks(d)).toEqual(response.result);
      expect(runChecks(normal)).toEqual(expectedNormal);
    } finally {
      registerScenarioPlanner(undefined);
      vi.unstubAllGlobals();
    }
  });
  it("plans only when the capacity check runs", async () => {
    vi.resetModules();
    const posted: CheckResponse[] = [];
    const scope = {
      onmessage: null as null | ((e: { data: CheckRequest }) => void),
      postMessage: (m: CheckResponse) => posted.push(m),
    };
    vi.stubGlobal("self", scope);
    try {
      await import("./worker");
      const simulation = await import("../sim/simulation");
      const played = vi.spyOn(simulation, "createSimulationRun");
      const off = plannerFixture();
      off.checks = { off: ["capacity"] };
      scope.onmessage!({ data: { id: 1, diagram: off } });
      expect(posted[0]).toMatchObject({ id: 1 });
      expect("result" in posted[0] && posted[0].plans).toBeUndefined();
      expect(played).not.toHaveBeenCalled();
      scope.onmessage!({ data: { id: 2, diagram: plannerFixture() } });
      expect("result" in posted[1] && posted[1].plans?.[0].suggestions[0]).toMatchObject({ kind: "max", to: 14 });
      played.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
