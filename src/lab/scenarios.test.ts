import { describe, expect, it } from "vitest";
import { scenarioDefs, scenarioDuration } from "./scenarios";
import { defaultsOf } from "./controls";
import { diagramProblems } from "./generators";
import { createScenarioRun, loadCreateEngine } from "./scenarioRunner";
import { getStencil, FALLBACK_STENCIL } from "../stencils/registry";

describe("scenario definitions", () => {
  for (const def of scenarioDefs) {
    const values = defaultsOf(def.controls);
    const diagram = def.diagram(values);
    const scenario = def.scenario(values);

    it(`${def.id}: diagram is valid and uses known stencils`, () => {
      expect(diagramProblems(diagram)).toEqual([]);
      for (const n of diagram.nodes) expect(getStencil(n.stencil), n.stencil).not.toBe(FALLBACK_STENCIL);
    });

    it(`${def.id}: script and checks reference existing nodes`, () => {
      const ids = new Set(diagram.nodes.map((n) => n.id));
      for (const a of scenario.script) if ("node" in a) expect(ids.has(a.node), a.node).toBe(true);
      expect(scenario.checks.length).toBeGreaterThan(0);
      expect(scenarioDuration(scenario)).toBeGreaterThan(Math.max(...scenario.checks.map((c) => c.at)));
    });
  }
});

// Headless contract tests for the sim engine (docs/SIMULATION.md), driven by the same scenarios the
// Lab shows. Skipped until src/sim/engine.ts exists.
const createEngine = await loadCreateEngine();

describe.skipIf(!createEngine)("scenarios against the sim engine", () => {
  for (const def of scenarioDefs) {
    it(`${def.id}: every check passes`, () => {
      const values = defaultsOf(def.controls);
      const run = createScenarioRun(createEngine!, def.diagram(values), def.scenario(values), { seed: 7 });
      run.fastForward();
      const failed = run.checks().filter((c) => c.status !== "pass");
      expect(failed, JSON.stringify(failed)).toEqual([]);
    });
  }

  it("runs are deterministic for a seed", () => {
    const def = scenarioDefs.find((d) => d.id === "sim-traffic-storm")!;
    const values = defaultsOf(def.controls);
    const once = () => {
      const run = createScenarioRun(createEngine!, def.diagram(values), def.scenario(values), { seed: 42 });
      const s = run.fastForward(5000);
      return Object.values(s.nodes).map((n) => [n.id, n.processed, n.backlog]);
    };
    expect(once()).toEqual(once());
  });
});
