import { describe, expect, it } from "vitest";
import { createEngine } from "../sim/engine";
import { createScenarioRun } from "./scenarioRunner";
import type { DiagramFile } from "../model/types";
import type { Scenario } from "./types";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Fixed ticks",
  nodes: [
    { id: "s", label: "Source", stencil: "client.browser", x: 0, y: 0, props: { ratePerSec: 100 } },
    { id: "t", label: "Sink", stencil: "generic.sink", x: 300, y: 0 },
  ],
  edges: [{ id: "e", from: "s", to: "t", props: { travelMs: 20 } }],
};
const factory: typeof createEngine = (opts) =>
  createEngine({ ...opts, roleOf: (id) => (id === "client.browser" ? "source" : "sink") });
const scenario: Scenario = {
  duration: 2000,
  script: [
    { at: 10, do: "inject", node: "s", count: 1 },
    { at: 1000, do: "traffic", on: true },
    { at: 1020, do: "traffic", on: false },
  ],
  checks: [{ at: 1050, label: "Three delivered", pass: (snap) => snap.nodes.t.processed === 3 }],
};

describe("scenario scheduling", () => {
  it("matches fixed ticks across frame sizes and fast-forward", () => {
    const fast = createScenarioRun(factory, diagram, scenario);
    const expected = fast.fastForward();
    for (const frame of [10, 37, 50]) {
      const run = createScenarioRun(factory, diagram, scenario);
      let left = 2000;
      while (left > 0) {
        const dt = Math.min(left, frame);
        run.advance(dt);
        left -= dt;
      }
      expect(run.snapshot()).toEqual(expected);
      expect(run.checks()[0].status).toBe("pass");
    }
  });
  it("retains fractional ticks across speed changes and clamps invalid speeds", () => {
    const run = createScenarioRun(factory, diagram, scenario);
    run.advance(7);
    run.setSpeed(2);
    expect(run.advance(1.5).time).toBe(10);
    run.setSpeed(Number.NaN);
    expect(run.advance(5).time).toBe(20);
    run.setSpeed(100);
    expect(run.advance(1.25).time).toBe(30);
  });
});
