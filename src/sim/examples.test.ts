import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { getStencil } from "../stencils/registry";
import { createSimulationRun } from "./simulation";
import { exampleTestLabel } from "./exampleLabels";

// Normal reports contain public examples only; local diagrams are never loaded here.
const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
/** Most examples tell two stories; these tell more. */
const SIMULATIONS: Record<string, number> = {
  // Catalogue-only showcase: Free play demonstrates the brands without adding a saved scenario.
  "../examples/vendor-edge-storefront.json": 0,
  "../examples/slow-payment-provider.json": 5,
  "../examples/retry-storm.json": 5,
  "../examples/scale-on-busy-threads.json": 3,
  "../examples/where-the-time-goes.json": 3,
  "../examples/aws-serverless-orders.json": 3,
  "../examples/black-friday-commerce.json": 3,
  "../examples/ev-charging-network.json": 4,
  "../examples/hybrid-enterprise-network.json": 3,
  "../examples/recommendations-feature-store.json": 4,
  "../examples/video-on-demand-pipeline.json": 3,
};

describe("saved example simulations with the real stencil registry", () => {
  for (const [index, [path, diagram]] of Object.entries(examples).entries()) {
    const label = exampleTestLabel(path, index);
    it(`${label} has the expected number of presentations and valid node references`, () => {
      if (SIMULATIONS[path] === 0) expect(diagram.simulations).toBeUndefined();
      else expect(diagram.simulations?.length).toBe(SIMULATIONS[path] ?? 2);
      const ids = new Set(diagram.nodes.map((node) => node.id));
      const edgeIds = new Set(diagram.edges.map((edge) => edge.id));
      for (const node of diagram.nodes) expect(getStencil(node.stencil).id).toBe(node.stencil);
      for (const simulation of diagram.simulations ?? []) {
        expect(simulation.seed).toBeTypeOf("number");
        for (const profile of simulation.traffic) expect(ids.has(profile.node)).toBe(true);
        for (const id of Object.keys(simulation.setup?.props ?? {})) expect(ids.has(id)).toBe(true);
        for (const id of Object.keys(simulation.setup?.status ?? {})) expect(ids.has(id)).toBe(true);
        for (const id of Object.keys(simulation.setup?.edges ?? {})) expect(edgeIds.has(id)).toBe(true);
        for (const step of simulation.timeline ?? []) {
          if (step.action.do === "note") {
            for (const id of step.action.focus ?? []) expect(ids.has(id)).toBe(true);
          } else if (step.action.do === "fault") {
            const f = step.action.fault;
            expect(
              f.kind === "boundary"
                ? diagram.groups?.some((g) => g.id === f.boundary)
                : f.kind === "link"
                  ? diagram.edges.some((e) => e.id === f.edge)
                  : ids.has(f.node),
            ).toBe(true);
          } else expect(ids.has(step.action.node)).toBe(true);
        }
        for (const expectation of simulation.expectations ?? []) {
          if ("node" in expectation.metric) expect(ids.has(expectation.metric.node)).toBe(true);
        }
      }
    });
    for (const [simulationIndex, simulation] of (diagram.simulations ?? []).entries()) {
      it(`${label}: simulation #${simulationIndex + 1} completes with the authored reliability outcome`, () => {
        const run = createSimulationRun(diagram, simulation);
        run.setSpeed(4);
        for (let frames = 0; frames <= 6000 && !run.state().done; frames++) {
          if (run.state().waiting) run.resume();
          run.step(25);
        }
        expect(run.state().done).toBe(true);
        expect(run.state().time).toBeLessThan(600_000);
        expect(run.state().expectations.map((e) => ({ id: e.id, status: e.status }))).toEqual(
          (simulation.expectations ?? []).map((e) => ({
            id: e.id,
            status:
              (path === "../examples/retry-storm.json" &&
                ["three-quick-retries", "jittered-backoff"].includes(simulation.id)) ||
              (["../examples/blocking-call.json", "../examples/scale-on-busy-threads.json"].includes(path) &&
                simulation.id === "blocking" &&
                e.id === "lag") ||
              (path === "../examples/slow-payment-provider.json" &&
                simulation.id === "blocking-pool" &&
                e.id === "status") ||
              (path === "../examples/slow-payment-provider.json" &&
                simulation.id === "no-timeouts" &&
                e.id === "gateway-timeouts") ||
              (path === "../examples/zone-outage-drill.json" &&
                simulation.id === "no-health-checks" &&
                e.id === "api-b-loss")
                ? "fail"
                : "pass",
          })),
        );
      });
    }
  }
});
