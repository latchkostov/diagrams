import { describe, expect, it, vi } from "vitest";
import * as simulation from "../sim/simulation";
import { plannerFixture } from "../lab/plannerFixture";
import type { CheckRequest, CheckResponse } from "./worker";

// The checks worker returns the capacity check's scenario sizing with its result, for the editor's main thread.
// A diagram with the capacity check turned off plans nothing: no saved simulation plays after an edit.

describe("checks worker", () => {
  it("plans only when the capacity check runs", async () => {
    const posted: CheckResponse[] = [];
    const scope = {
      onmessage: null as null | ((e: { data: CheckRequest }) => void),
      postMessage: (m: CheckResponse) => posted.push(m),
    };
    vi.stubGlobal("self", scope);
    try {
      await import("./worker");
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
