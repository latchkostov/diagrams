import { describe, expect, it } from "vitest";
import { faultProblem, faultSchema, type Fault } from "./faults";
import { boundaryOutage } from "./faultRuntime";
import { simulationProblem } from "../interop/native";
import { checkJsonSchema } from "./jsonSchema";
import { diagramV1Schema } from "./diagramSchema";
import { checkSchema } from "../ai/validation";
import { buildSimulation } from "../ai/simulate";
import { describeDiagram } from "../ai/describe";
import { faultDrillFixture } from "../lab/faultDrillFixture";

describe("fault contracts", () => {
  it.each([
    ["worker", "zone-b"],
    ["caller", undefined],
    ["missing", undefined],
  ])("guards restoration of %s only under its enclosing outage", (node, expected) => {
    expect(boundaryOutage(faultDrillFixture(), node!, [{ kind: "boundary", boundary: "zone-b", down: true }])?.id).toBe(
      expected,
    );
    expect(boundaryOutage(faultDrillFixture(), node!)?.id).toBeUndefined();
    expect(
      boundaryOutage(faultDrillFixture(), node!, [{ kind: "boundary", boundary: "zone-b", down: false }])?.id,
    ).toBeUndefined();
  });
  it.each<Fault>([
    { kind: "boundary", boundary: "zone-b", down: true },
    { kind: "boundary", boundary: "zone-b", down: false },
    { kind: "link", edge: "request", cut: true },
    { kind: "link", edge: "request", cut: false },
    ...([1, 2, 5, 10] as const).map((factor) => ({ kind: "slow" as const, node: "worker", factor })),
    ...([0, 0.1, 0.5] as const).map((rate) => ({ kind: "fail" as const, node: "worker", rate })),
  ])("roundtrips $kind through native and agent/WebMCP schemas, including clearing it", (fault) => {
    expect(faultProblem(fault)).toBeUndefined();
    expect(() => checkSchema(fault, faultSchema)).not.toThrow();
    const d = faultDrillFixture();
    d.simulations![0].timeline = [{ atMs: 100, action: { do: "fault", fault } }];
    expect(simulationProblem(d.simulations![0])).toBeUndefined();
    expect(() => checkJsonSchema(d, diagramV1Schema, "file", diagramV1Schema.$defs)).not.toThrow();
    const sim = buildSimulation(d, { title: "Saved drill", traffic: [], faults: [{ atSec: 0.1, fault }] });
    expect(sim.timeline).toEqual(d.simulations![0].timeline);
    expect(describeDiagram({ ...d, simulations: [sim] })).toContain(JSON.stringify(sim.timeline));
  });

  it.each([
    null,
    {},
    { kind: "slow", node: "worker", factor: 3 },
    { kind: "slow", node: "worker", factor: Infinity },
    { kind: "fail", node: "worker", rate: 1 },
    { kind: "fail", node: "worker", rate: NaN },
    { kind: "boundary", boundary: "zone-b", down: "yes" },
    { kind: "link", edge: "request", cut: 1 },
    { kind: "link", edge: "", cut: true },
    { kind: "unknown", node: "worker" },
  ])("rejects malformed or unsupported fault %j", (fault) => {
    expect(faultProblem(fault)).toBeTypeOf("string");
    expect(() => checkSchema(fault, faultSchema)).toThrow();
    expect(
      simulationProblem({
        id: "drill",
        title: "Invalid",
        traffic: [],
        timeline: [{ atMs: 0, action: { do: "fault", fault } }],
      }),
    ).toBeTypeOf("string");
  });

  it("resolves node, boundary and connection labels for agent-authored named drills and rejects an in-boundary cut", () => {
    const d = faultDrillFixture();
    const sim = buildSimulation(d, {
      title: "Game day",
      traffic: [],
      faults: [
        { atSec: 3, fault: { kind: "boundary", boundary: "Zone b", down: true }, drill: "zone-outage" },
        { atSec: 4, fault: { kind: "link", edge: "Caller -> Worker", cut: true }, drill: "region-connectivity" },
        { atSec: 5, fault: { kind: "slow", node: "Worker", factor: 5 }, drill: "slow-dependency" },
        { atSec: 6, fault: { kind: "fail", node: "Worker", rate: 0.5 }, drill: "error-spike" },
      ],
    });
    expect(sim.timeline?.map((s) => s.action)).toEqual([
      { do: "fault", fault: { kind: "boundary", boundary: "zone-b", down: true }, drill: "zone-outage" },
      { do: "fault", fault: { kind: "link", edge: "request", cut: true }, drill: "region-connectivity" },
      { do: "fault", fault: { kind: "slow", node: "worker", factor: 5 }, drill: "slow-dependency" },
      { do: "fault", fault: { kind: "fail", node: "worker", rate: 0.5 }, drill: "error-spike" },
    ]);
    expect(() =>
      buildSimulation(d, {
        title: "Invalid cut",
        traffic: [],
        faults: [{ atSec: 0, fault: { kind: "link", edge: "write", cut: true } }],
      }),
    ).toThrow("between two boundaries");
  });
});
