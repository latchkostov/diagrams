import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import type { SimulationSpec } from "./index";
import { buildSimulation } from "./simulate";
import { simulationProblem, validateDiagram } from "../interop/native";

const diagram = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Traffic",
  nodes: [
    { id: "a", stencil: "service.dotnet", label: "API", x: 0, y: 0 },
    { id: "b", stencil: "postgres", label: "DB", x: 400, y: 0 },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
});
const spec = (): SimulationSpec => ({
  title: "Peak",
  traffic: [{ from: "API", pattern: "constant", ratePerSec: 1000 }],
});

describe("buildSimulation", () => {
  it("translates seconds, references, units and autoscale without mutation", () => {
    const d = diagram(),
      saved = structuredClone(d);
    const sim = buildSimulation(d, spec());
    expect(sim.traffic[0]).toMatchObject({
      node: "a",
      shape: { kind: "constant", ratePerSec: 1000, fromMs: 0, durationMs: 60000 },
    });
    expect(sim.scale).toBe(20);
    expect(sim.durationMs).toBe(60000);
    expect(d).toEqual(saved);
    expect(simulationProblem(sim)).toBeUndefined();
    expect(validateDiagram({ ...d, simulations: [sim] }).ok).toBe(true);
  });
  it.each([
    [
      { pattern: "burst", count: 20, startSec: 2, durationSec: 3 },
      { kind: "burst", count: 20, atMs: 2000, spreadMs: 3000 },
    ],
    [
      { pattern: "ramp", ratePerSec: 2, toRatePerSec: 20, startSec: 1, durationSec: 5 },
      { kind: "ramp", startRate: 2, fromMs: 1000, stages: [{ targetRate: 20, durationMs: 5000 }] },
    ],
    [
      { pattern: "spike", ratePerSec: 2, toRatePerSec: 50, startSec: 5, peakSec: 2, durationSec: 20 },
      { kind: "spike", baseRate: 2, peakRate: 50, atMs: 5000, peakMs: 2000, durationMs: 20000 },
    ],
  ])("maps %j", (input, expected) => {
    const sim = buildSimulation(diagram(), {
      title: "Shape",
      traffic: [{ from: "a", ...input } as SimulationSpec["traffic"][number]],
    });
    expect(sim.traffic[0].shape).toEqual(expected);
  });
  it("maps all event types, sorts time and adds focused narration", () => {
    const sim = buildSimulation(diagram(), {
      ...spec(),
      events: [
        { atSec: 10, node: "DB", do: "down", note: "Database down" },
        { atSec: 5, node: "API", do: "pause" },
        { atSec: 12, node: "DB", do: "up" },
        { atSec: 13, node: "API", do: "slow", latencyMs: 100 },
        { atSec: 14, node: "API", do: "set", props: { replicas: 4 } },
      ],
    });
    expect(sim.timeline?.map((s) => s.atMs)).toEqual([5000, 10000, 10000, 12000, 13000, 14000]);
    expect(sim.timeline?.map((s) => s.action)).toEqual([
      { do: "status", node: "a", status: "paused" },
      { do: "status", node: "b", status: "down" },
      { do: "note", text: "Database down", focus: ["b"] },
      { do: "status", node: "b", status: "up" },
      { do: "props", node: "a", props: { latencyMs: 100 } },
      { do: "props", node: "a", props: { replicas: 4 } },
    ]);
  });
  it("maps node and system expectations with default end timing", () => {
    const sim = buildSimulation(diagram(), {
      ...spec(),
      expectations: [
        { label: "Drains", metric: "inSystem", op: "==", value: 0 },
        { label: "No failures", node: "DB", metric: "failed", op: "<=", value: 0, when: "always" },
      ],
    });
    expect(sim.expectations).toMatchObject([
      { metric: { system: "inSystem" }, when: "end" },
      { metric: { node: "b", field: "failed" }, when: "always" },
    ]);
  });
  it("reuses a replacement id and rejects ambiguous titles", () => {
    const d = diagram();
    const sim = buildSimulation(d, spec());
    d.simulations = [sim];
    expect(buildSimulation(d, { ...spec(), replace: " peak " }).id).toBe(sim.id);
    expect(buildSimulation(d, spec()).id).not.toBe(sim.id);
    d.simulations.push({ ...sim, id: "other" });
    expect(() => buildSimulation(d, { ...spec(), replace: "Peak" })).toThrow("matches 2");
    expect(buildSimulation(d, { ...spec(), replace: sim.id }).id).toBe(sim.id);
  });
  it.each([
    { traffic: [{ from: "API", pattern: "constant" }] },
    { traffic: [{ from: "zzz", pattern: "burst", count: 1 }] },
    { durationSec: 3600 },
    { traffic: [{ from: "API", pattern: "constant", ratePerSec: 10001 }] },
    { traffic: [{ from: "API", pattern: "burst", count: 100001 }] },
    { traffic: [{ from: "API", pattern: "constant", ratePerSec: 10000, durationSec: 60 }] },
    { events: [{ atSec: 1, node: "DB", do: "slow" }] },
    { events: [{ atSec: 1, node: "DB", do: "set" }] },
    { expectations: [{ label: "Broken", metric: "backlog", op: "==", value: 0 }] },
  ])("rejects missing fields, unresolved refs and native budgets: %j", (patch) =>
    expect(() => buildSimulation(diagram(), { ...spec(), ...patch } as SimulationSpec)).toThrow(),
  );
  it("enforces document-wide volume even across simulations", () => {
    const d = diagram();
    d.simulations = [
      buildSimulation(d, { ...spec(), traffic: [{ from: "API", pattern: "burst", count: 100000 }] }),
      { id: "second", title: "Second", traffic: [{ id: "t", node: "a", shape: { kind: "burst", count: 100000 } }] },
    ];
    expect(() => buildSimulation(d, spec())).toThrow("volume budget");
  });
});
