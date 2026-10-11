import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { getStencil } from "../stencils/registry";
import { createSimulationRun } from "./simulation";

// Local-only diagrams in ../examples/private (gitignored) are checked too when present.
const examples = import.meta.glob<DiagramFile>(["../examples/*.json", "../examples/private/*.json"], { eager: true, import: "default" });

describe("saved example simulations with the real stencil registry", () => {
  for (const [path, diagram] of Object.entries(examples)) {
    it(`${path} has the expected number of presentations and valid node references`, () => {
      if (path.includes("private/")) expect(diagram.simulations?.length ?? 0).toBeGreaterThan(0);
      else expect(diagram.simulations?.length).toBe(2);
      const ids = new Set(diagram.nodes.map(node => node.id));
      for (const node of diagram.nodes) expect(getStencil(node.stencil).id).toBe(node.stencil);
      for (const simulation of diagram.simulations ?? []) {
        expect(simulation.seed).toBeTypeOf("number");
        for (const profile of simulation.traffic) expect(ids.has(profile.node)).toBe(true);
        for (const id of Object.keys(simulation.setup?.props ?? {})) expect(ids.has(id)).toBe(true);
        for (const id of Object.keys(simulation.setup?.status ?? {})) expect(ids.has(id)).toBe(true);
        for (const step of simulation.timeline ?? []) {
          if (step.action.do === "note") {
            for (const id of step.action.focus ?? []) expect(ids.has(id)).toBe(true);
          } else expect(ids.has(step.action.node)).toBe(true);
        }
        for (const expectation of simulation.expectations ?? []) {
          if ("node" in expectation.metric) expect(ids.has(expectation.metric.node)).toBe(true);
        }
      }
    });
    for (const simulation of diagram.simulations ?? []) {
      it(`${diagram.title}: ${simulation.title} completes and passes every expectation`, () => {
        const run = createSimulationRun(diagram, simulation);
        run.engine.setSpeed(4);
        for (let frames = 0; frames <= 6000 && !run.state().done; frames++) {
          if (run.state().waiting) run.resume();
          run.step(25);
        }
        expect(run.state().done).toBe(true);
        expect(run.state().time).toBeLessThan(600_000);
        expect(run.state().expectations.filter(e => e.status !== "pass")).toEqual([]);
      });
    }
  }
});
