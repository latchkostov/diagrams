import { describe, expect, it, vi } from "vitest";
import { plannerFixture } from "../lab/plannerFixture";
import type { CheckRequest, CheckResponse } from "./worker";
import busy from "../examples/scale-on-busy-threads.json";
import type { DiagramFile } from "../model/types";
import { waitingFixture } from "../lab/waitingFixture";

// The checks worker returns the capacity check's scenario sizing with its result, for the editor's main thread.
// A diagram with the capacity check turned off plans nothing: no saved simulation plays after an edit.

describe("checks worker", () => {
  it.each([false, true])(
    "request-only findings and required plans reach the caller (worker fails: %s)",
    async (fails) => {
      vi.resetModules();
      const posted: CheckResponse[] = [];
      const scope = {
        onmessage: null as null | ((e: { data: CheckRequest }) => void),
        postMessage: (message: CheckResponse) => posted.push(message),
      };
      vi.stubGlobal("self", scope);
      const requests: CheckRequest[] = [];
      class ChecksWorker {
        onmessage?: (e: { data: CheckResponse }) => void;
        onerror?: (e: { preventDefault(): void; message: string }) => void;
        terminate() {}
        postMessage(request: CheckRequest) {
          requests.push(request);
          queueMicrotask(() => {
            if (fails) this.onerror?.({ preventDefault() {}, message: "Download failed" });
            else {
              scope.onmessage!({ data: request });
              this.onmessage?.({ data: posted.at(-1)! });
            }
          });
        }
      }
      vi.stubGlobal("Worker", ChecksWorker);
      const { registerScenarioPlanner, offThreadPlans } = await import("../lib/scenarioPlanner");
      try {
        await import("./worker");
        const { requestChecksOffThread } = await import("../canvas/checks/runner");
        const run = await import("./run");
        const checks = vi.spyOn(run, "runChecks");
        registerScenarioPlanner(async () => []);
        const d = plannerFixture();
        d.planning = { ...d.planning, revision: "p3-w1" };
        d.nodes[0].id = "shoppers";
        d.edges[0].from = "shoppers";
        d.simulations![0].traffic[0].node = "shoppers";
        // The blocked caller consults scenario sizing, which also sizes this independent HPA workload.
        const blocked = waitingFixture();
        blocked.nodes[0].props!.ratePerSec = 100;
        d.nodes.push(...blocked.nodes);
        d.edges.push(...blocked.edges);
        const findings = await requestChecksOffThread(d);
        expect(requests).toEqual([{ id: expect.any(Number), diagram: d, requests: true }]);
        expect(findings.map((f) => f.id)).toEqual(["blocked-threads:caller", "call-timeout:call"]);
        expect(findings.find((f) => f.id === "blocked-threads:caller")?.fix?.requestLabel).toEqual({ kind: "free" });
        expect(checks).not.toHaveBeenCalled();
        const plans = offThreadPlans(d)?.plans;
        expect(plans?.[0]?.simulation).toBe("black-friday");
        expect(plans).toHaveLength(d.simulations!.length);
        expect(plans?.[0]?.suggestions[0]).toMatchObject({ kind: "max", to: 14 });
        if (!fails) {
          expect(posted).toEqual([{ id: requests[0].id, requestsOnly: findings, plans }]);
        } else expect(posted).toEqual([]);
      } finally {
        registerScenarioPlanner(undefined);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
    },
  );

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
  it("works out request findings and the checks from one capacity analysis", async () => {
    vi.resetModules();
    const posted: CheckResponse[] = [];
    const scope = {
      onmessage: null as null | ((e: { data: CheckRequest }) => void),
      postMessage: (m: CheckResponse) => posted.push(m),
    };
    vi.stubGlobal("self", scope);
    try {
      await import("./worker");
      const capacity = await import("../sim/capacity");
      const analyses = vi.spyOn(capacity, "analyzeCapacity");
      const d = waitingFixture();
      d.nodes[0].props!.ratePerSec = 100;
      scope.onmessage!({ data: { id: 1, diagram: d } });
      expect("result" in posted[0] && posted[0].requests?.map((f) => f.id)).toContain("blocked-threads:caller");
      const worker = analyses.mock.calls.length;
      // The same checks on this thread, on content the worker hasn't seen: as many analyses as the worker's (the
      // free-play analysis once, plus the one sizing the replicas option works out), not one more per message.
      analyses.mockClear();
      const { runChecks } = await import("./run");
      const other = structuredClone(d);
      other.nodes[1].label = "Another decision service";
      runChecks(other);
      expect(worker).toBe(analyses.mock.calls.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
