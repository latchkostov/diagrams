import { cacheFixture } from "../lab/cacheFixture";
import "../sim/cache/cacheRuntime";
import { createSimulationRun } from "../sim/simulation";
import { faultTimelineProblem } from "../model/faultRuntime";
import { faultStepCaches } from "./faults";
import { expect, it } from "vitest";
import { simulationFieldErrors } from "./validate";
import { LIMITS } from "../interop/native";
import { editableProperties } from "./editableProperties";
import type { DiagramFile, Simulation, TrafficShape } from "../model/types";
import { purgeEditorFixture } from "../lab/cachePurgeFixture";
import { timelineConfigurations } from "../model/timelineConfiguration";
import { t } from "../i18n";

it("accepts a purge of a rule supplied only by the selected setup", () => {
  const d = purgeEditorFixture(),
    simulation = d.simulations![0];
  simulation.timeline = [{ atMs: 0, action: { do: "fault", fault: { kind: "purge", node: "cdn", rule: "__all" } } }];
  expect(simulationFieldErrors(simulation, d)).toEqual([]);
});

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

const burst: TrafficShape = { kind: "burst", count: 10, atMs: 0, spreadMs: 1000 };
const constant: TrafficShape = { kind: "constant", ratePerSec: 10, fromMs: 0, durationMs: 1000 };
const ramp: TrafficShape = { kind: "ramp", fromMs: 0, startRate: 10, stages: [{ durationMs: 1000, targetRate: 20 }] };
const spike: TrafficShape = { kind: "spike", baseRate: 10, peakRate: 20, atMs: 0, peakMs: 1000, durationMs: 2000 };

it.each<{ field: string; shape: TrafficShape; key: string; text: string }>([
  { field: "count", shape: burst, key: "count", text: "Messages: enter a whole number from 0 to 100,000." },
  { field: "at", shape: burst, key: "atMs", text: "At (s): enter a number from 0 to 600." },
  { field: "spread", shape: burst, key: "spreadMs", text: "Over (s): enter a number from 0 to 600." },
  { field: "rate", shape: constant, key: "ratePerSec", text: "Rate (/s): enter a number from 0 to 10,000,000." },
  { field: "from", shape: constant, key: "fromMs", text: "From (s): enter a number from 0 to 600." },
  { field: "duration", shape: constant, key: "durationMs", text: "For (s): enter a number from 0 to 600." },
  { field: "from", shape: ramp, key: "fromMs", text: "From (s): enter a number from 0 to 600." },
  { field: "start-rate", shape: ramp, key: "startRate", text: "Start rate (/s): enter a number from 0 to 10,000,000." },
  { field: "base", shape: spike, key: "baseRate", text: "Base (/s): enter a number from 0 to 10,000,000." },
  { field: "peak", shape: spike, key: "peakRate", text: "Peak (/s): enter a number from 0 to 10,000,000." },
  { field: "at", shape: spike, key: "atMs", text: "Peak at (s): enter a number from 0 to 600." },
  { field: "peak-for", shape: spike, key: "peakMs", text: "Peak for (s): enter a number from 0 to 600." },
  { field: "duration", shape: spike, key: "durationMs", text: "Total (s): enter a number from 0 to 600." },
])("reports the exact diagnostic for $shape.kind $field", ({ field, shape, key, text }) => {
  expect(simulationFieldErrors(sim({ ...shape, [key]: Infinity }), diagram)).toEqual([
    { field: `sim-panel-traffic-0-${field}`, text: `Traffic 1: ${text}` },
  ]);
  expect(simulationFieldErrors(sim(shape), diagram)).toEqual([]);
});

it.each([
  { field: "duration", key: "durationMs", text: "seconds: enter a number from 0 to 600." },
  { field: "rate", key: "targetRate", text: "target rate (/s): enter a number from 0 to 10,000,000." },
])("reports the exact diagnostic for ramp stage $field", ({ field, key, text }) => {
  const shape: TrafficShape = { kind: "ramp", stages: [{ durationMs: 1000, targetRate: 10, [key]: Infinity }] };
  expect(simulationFieldErrors(sim(shape), diagram)).toEqual([
    { field: `sim-panel-traffic-0-stage-0-${field}`, text: `Traffic 1: Stage 1 ${text}` },
  ]);
  expect(simulationFieldErrors(sim({ kind: "ramp", stages: [{ durationMs: 1000, targetRate: 10 }] }), diagram)).toEqual(
    [],
  );
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
  expect(simulationFieldErrors(draft, diagram)).toEqual([
    { field: "sim-panel-duration", text: "Stop after (s): enter a number from 0 to 600." },
    { field: "sim-panel-traffic-0-node", text: "Traffic 1: Starts at: choose an existing target in this diagram." },
    { field: "sim-panel-step-0-time", text: "Timeline 1: Time (s): enter a number from 0 to 600." },
    { field: "sim-panel-step-0-fault-target", text: "Timeline 1: Target: choose an existing target in this diagram." },
    {
      field: "sim-panel-expectation-0-node",
      text: "Expectation 1: Metric node: choose an existing target in this diagram.",
    },
    { field: "sim-panel-expectation-0-value", text: "Expectation 1: Value: enter a finite number." },
  ]);
  draft.durationMs = 1000;
  draft.traffic[0].node = "api";
  draft.timeline = [{ atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "api", factor: 1 } } }];
  draft.expectations[0].metric = { node: "api", field: "processed" };
  draft.expectations[0].value = 1;
  expect(simulationFieldErrors(draft, diagram)).toEqual([]);
});

it.each([
  ["latencyMs", "600,000"],
  ["concurrency", "10,000"],
  ["failureRate", "1"],
  ["partitions", "10,000"],
  ["ratePerSec", "10,000,000"],
  ["maxDeliveryCount", "10,000"],
])("reports the exact diagnostic for timeline property %s", (key, limit) => {
  const draft = sim({ kind: "burst", count: 10 });
  draft.timeline = [{ atMs: 0, action: { do: "props", node: "api", props: { [key]: Infinity } } }];
  expect(simulationFieldErrors(draft, diagram)).toEqual([
    { field: "sim-panel-step-0-value", text: `Timeline 1: ${key}: enter a number from 0 to ${limit}.` },
  ]);
  draft.timeline[0].action = { do: "props", node: "api", props: { [key]: 1 } };
  expect(simulationFieldErrors(draft, diagram)).toEqual([]);
});

it("checks every editable property using its shared upper bound", () => {
  for (const property of editableProperties) {
    const draft = sim(burst);
    draft.timeline = [{ atMs: 0, action: { do: "props", node: "api", props: { [property.key]: property.maximum } } }];
    expect(simulationFieldErrors(draft, diagram)).toEqual([]);
    draft.timeline[0].action = { do: "props", node: "api", props: { [property.key]: property.maximum + 1 } };
    expect(simulationFieldErrors(draft, diagram)).toHaveLength(1);
  }
});

it("validates purge rules in stable playback order and shares the effective configuration with the step editor", () => {
  const d = cacheFixture();
  const cache = { rules: [{ id: "new", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 1 } }] };
  const draft: Simulation = {
    id: "timeline-rules",
    title: "Timeline rules",
    traffic: [],
    timeline: [
      { atMs: 2000, action: { do: "fault", fault: { kind: "purge", node: "cache", rule: "new" } } },
      { atMs: 1000, action: { do: "props", node: "cache", props: { cache } } },
    ],
  };
  expect(faultTimelineProblem(d, draft)).toBeUndefined();
  expect(simulationFieldErrors(draft, d)).toEqual([]);
  expect(faultStepCaches(d, draft).get(0)!.table).toBe(cache);
  const run = createSimulationRun(d, draft, { maxParticles: 0 });
  run.step(2100);
  run.engine.inject("source", 1, { type: "Page" });
  run.engine.step(500);
  expect(run.engine.snapshot().nodes.cache.cache!.rules.new.misses).toBe(1);
  const repeated: Simulation = {
    ...draft,
    timeline: [
      draft.timeline![0],
      { atMs: 2001, action: draft.timeline![0].action },
      { atMs: 2002, action: { do: "props", node: "cache", props: { latencyMs: 5 } } },
      { atMs: 2003, action: draft.timeline![0].action },
    ],
  };
  const configurations = faultStepCaches(d, repeated);
  expect(configurations.get(1)!.table).toBe(configurations.get(0)!.table);
  expect(configurations.get(3)!.table).toBe(configurations.get(0)!.table);
  draft.timeline!.push({
    atMs: 2000,
    action: { do: "props", node: "cache", props: { cache: { rules: [], default: { ttlMs: 1000, keys: 1 } } } },
  });
  // Equal-time array order: removal is after the purge.
  expect(faultTimelineProblem(d, draft)).toBeUndefined();
  draft.timeline![2].atMs = 1500;
  expect(faultTimelineProblem(d, draft)).toBeDefined();
  expect(simulationFieldErrors(draft, d)).toEqual([
    {
      field: "sim-panel-step-0-fault-rule",
      text: "Rule: choose an existing target in this diagram.",
    },
  ]);
  draft.timeline![0].action = { do: "fault", fault: { kind: "purge", node: "cache" } };
  expect(simulationFieldErrors(draft, d)).toEqual([]);
});

it("keeps the imported 5,000-node / 10,000-step amplification case linear without cloning node records", () => {
  let copied = 0;
  const d: DiagramFile = {
    ...diagram,
    groups: [{ id: "zone", label: "Zone", x: 0, y: 0, width: 100, height: 100 }],
    nodes: Array.from({ length: 5000 }, (_, i) => ({
      ...diagram.nodes[0],
      id: `n${i}`,
      group: "zone",
      get x() {
        copied++;
        if (copied > 1) throw new Error("Timeline resolver cloned node records");
        return 0;
      },
    })),
  };
  const draft: Simulation = {
    id: "amplification",
    title: "Amplification",
    traffic: [],
    timeline: Array.from({ length: 10_000 }, (_, i) => ({
      atMs: i,
      action:
        i % 2 === 0
          ? { do: "props", node: "n0", props: { latencyMs: i } }
          : { do: "fault", fault: { kind: "boundary", boundary: "zone", down: true } },
    })),
  };
  expect(faultStepCaches(d, draft).size).toBe(0);
  expect(simulationFieldErrors(draft, d)).toEqual([]);
  expect(faultTimelineProblem(d, draft)).toBeUndefined();
  let entries = 0;
  const maps = new Set<object>();
  for (const [, caches] of timelineConfigurations(d, draft)) {
    entries++;
    maps.add(caches);
    expect(caches.size).toBe(0);
  }
  expect(entries).toBe(draft.timeline!.filter((s) => s.action.do === "fault").length);
  expect(maps.size).toBe(1);
  expect(copied).toBe(0);
});

it("rejects configuration work before reading or allocating node records", () => {
  const d = cacheFixture();
  const draft: Simulation = {
    id: "over-budget",
    title: "Over budget",
    traffic: [],
    timeline: Array.from({ length: 5000 }, (_, atMs) => ({
      atMs,
      action: { do: "fault", fault: { kind: "purge", node: "cache" } },
    })),
  };
  d.nodes.push(...Array.from({ length: 5000 - d.nodes.length }, (_, i) => ({ ...diagram.nodes[0], id: `n${i}` })));
  expect(faultTimelineProblem(d, draft)).toBe(t("fault.workBudget"));
  d.nodes = new Proxy(d.nodes, {
    get(_nodes, key) {
      if (key === "length") return 5000;
      throw new Error(`Node records accessed before admission: ${String(key)}`);
    },
  });
  expect(faultStepCaches(d, draft).size).toBe(0);
  draft.timeline = [];
  d.nodes = new Proxy(d.nodes, {
    get(_nodes, key) {
      if (key === "length") return 1_000_001;
      throw new Error(`Node records accessed before admission: ${String(key)}`);
    },
  });
  expect(faultTimelineProblem(d, draft)).toBe(t("fault.workBudget"));
});
