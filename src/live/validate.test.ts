import { expect, it } from "vitest";
import { simulationFieldErrors } from "./validate";
import { LIMITS } from "../interop/native";
import type { DiagramFile, Simulation, TrafficShape } from "../model/types";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Validation",
  nodes: [{ id: "api", stencil: "generic.service", label: "API", x: 0, y: 0 }],
  edges: [],
};
const sim = (shape: TrafficShape): Simulation => ({
  id: "test",
  title: "Test",
  traffic: [{ id: "load", node: "api", shape }],
});

it.each<TrafficShape>([
  { kind: "burst", count: LIMITS.maxMessageCount + 1 },
  { kind: "constant", ratePerSec: LIMITS.maxRatePerSec + 1, durationMs: 1000 },
  { kind: "ramp", stages: [{ durationMs: LIMITS.maxSimulationMs + 1, targetRate: -1 }] },
  { kind: "spike", baseRate: -1, peakRate: LIMITS.maxRatePerSec + 1, atMs: 0, peakMs: 1000, durationMs: 2000 },
])("names invalid shape fields and their accepted limits ($kind)", (shape) => {
  const errors = simulationFieldErrors(sim(shape), diagram);
  expect(errors.length).toBeGreaterThan(0);
  for (const error of errors) {
    expect(error.field).toMatch(/^sim-panel-traffic-0-/);
    expect(error.text).toMatch(/^Traffic 1: .+: enter a (whole )?number from 0 to [\d,]+\.$/);
  }
});

it("names timeline, expectation, duration and target failures and accepts repaired fields", () => {
  const draft = sim({ kind: "burst", count: 10 });
  draft.durationMs = LIMITS.maxSimulationMs + 1000;
  draft.traffic[0].node = "missing";
  draft.timeline = [
    {
      atMs: LIMITS.maxSimulationMs + 1000,
      action: { do: "fault", fault: { kind: "boundary", boundary: "missing", down: true } },
    },
  ];
  draft.expectations = [
    { id: "check", label: "Check", metric: { node: "missing", field: "processed" }, op: ">=", value: Infinity },
  ];
  expect(simulationFieldErrors(draft, diagram).map((e) => e.field)).toEqual([
    "sim-panel-duration",
    "sim-panel-traffic-0-node",
    "sim-panel-step-0-time",
    "sim-panel-step-0-fault-target",
    "sim-panel-expectation-0-node",
    "sim-panel-expectation-0-value",
  ]);
  expect(simulationFieldErrors(draft, diagram)[0].text).toBe("Stop after (s): enter a number from 0 to 600.");
  expect(simulationFieldErrors(draft, diagram)[3].text).toBe(
    "Timeline 1: Target: choose an existing target in this diagram.",
  );
  expect(simulationFieldErrors(sim({ kind: "burst", count: 10 }), diagram)).toEqual([]);
});

it("associates a changed property's range with its Value control", () => {
  const draft = sim({ kind: "burst", count: 10 });
  draft.timeline = [{ atMs: 0, action: { do: "props", node: "api", props: { failureRate: 2 } } }];
  expect(simulationFieldErrors(draft, diagram)).toEqual([
    { field: "sim-panel-step-0-value", text: "Timeline 1: failureRate: enter a number from 0 to 1." },
  ]);
});
