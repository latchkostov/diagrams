import { resourceLesson, hpaLesson } from "./autoscaling";
import { parseNative } from "../interop/native";
import { describe, expect, it } from "vitest";
import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import { diagramV1Schema, diagramV2Schema } from "./diagramSchema";
import { EDGE_RELATIONS } from "./relations";
import { isColorValue } from "./annotations";
import type {
  DiagramAnnotation,
  DiagramEdge,
  DiagramFile,
  DiagramGroup,
  DiagramNode,
  Expectation,
  Simulation,
  TrafficProfile,
} from "./types";

// The published file format (public/schema/diagram.v1.json) must describe every field the app saves.
// The fixtures are typed Required<...>, so adding a field to a type fails typecheck here until the
// fixture has it, and then fails the strict check below until the schema has it too.

/** The schema with every closed-looking object closed: `properties` and no `additionalProperties`. */
function strict(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== "object") return schema;
  const out = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, k === "enum" ? v : strict(v)]));
  if (out.properties && !("additionalProperties" in out)) out.additionalProperties = false;
  return out;
}

const schema = strict(diagramV1Schema) as JsonSchema;
const planningSchema = strict(diagramV2Schema) as JsonSchema;
const defs = schema.$defs as Record<string, JsonSchema>;
const check = (value: unknown, def?: string) =>
  checkJsonSchema(
    value,
    def ? defs[def] : (value as DiagramFile).format === "diagrams/v2" ? planningSchema : schema,
    def ?? "file",
    !def && (value as DiagramFile).format === "diagrams/v2"
      ? (planningSchema.$defs as Record<string, JsonSchema>)
      : defs,
  );

const node: Required<DiagramNode> = {
  id: "api",
  stencil: "service.dotnet",
  label: "API",
  sublabel: "orders",
  description: "Handles orders and payments.",
  x: 100,
  y: 80,
  group: "cloud",
  props: { replicas: 2, latencyMs: 20 },
};
const edge: Required<DiagramEdge> = {
  id: "e1",
  from: "api",
  to: "config",
  label: "reads",
  kind: "sync",
  relation: "config",
  relationOrigin: "inferred",
  sourceSide: "right",
  targetSide: "left",
  waypoints: [{ x: 300, y: 100 }],
  props: { settings: [{ key: "Orders:Timeout" }, { key: "Db:Password", secret: true }], travelMs: 5 },
};
const group: Required<DiagramGroup> = {
  id: "cloud",
  label: "Cloud",
  tone: "azure",
  x: 0,
  y: 0,
  width: 800,
  height: 400,
  group: "region",
};
const annotation: Required<DiagramAnnotation> = {
  id: "shape",
  kind: "shape",
  text: "Legacy",
  x: 900,
  y: 0,
  width: 160,
  height: 80,
  shape: "cylinder",
  color: "purple",
  textSize: "l",
  group: "cloud",
};
const traffic: Required<TrafficProfile> = {
  id: "t1",
  node: "api",
  messageType: "OrderPlaced",
  label: "Orders",
  shape: { kind: "constant", ratePerSec: 10, durationMs: 1000 },
};
const expectation: Required<Expectation> = {
  id: "x1",
  label: "Lag stays low",
  metric: { node: "api", field: "lag", group: "billing" },
  op: "<",
  value: 100,
  when: "at",
  atMs: 500,
};
const simulation: Required<Simulation> = {
  id: "s1",
  title: "Steady",
  description: "Ten a second.",
  seed: 7,
  scale: 10,
  multipliers: { traffic: 2, capacity: 1 },
  durationMs: 2000,
  setup: { status: { api: "paused" }, props: { api: { latencyMs: 50 } } },
  traffic: [traffic],
  timeline: [
    { atMs: 100, action: { do: "status", node: "api", status: "up" } },
    { atMs: 200, action: { do: "note", text: "Watch the lag", focus: ["api"], pause: true } },
  ],
  expectations: [expectation],
};
const file: Required<DiagramFile> = {
  format: "diagrams/v2",
  planning: { revision: "p1" },
  title: "Everything",
  description: "Every field the format has.",
  color: "#3B82F6",
  direction: "TB",
  groups: [group],
  nodes: [node, { id: "config", stencil: "azure.app-config", label: "Config", x: 400, y: 80 }],
  edges: [edge],
  simulations: [simulation],
  annotations: [annotation],
  layerOrder: ["shape", "api", "config"],
  private: true,
  checks: { off: ["capacity"], ignore: [{ rule: "dead-letter", target: "api", reason: "Retries forever" }] },
};

describe("diagram.v1 schema", () => {
  it.each(["#abc", "#abcd", "#fff0", "#abcdef", "#abcdef00", "#11223344", "white", "blue"])(
    "accepts the model colour contract in both schemas and annotation colours: %s",
    (color) => {
      expect(isColorValue(color)).toBe(true);
      expect(() => check({ ...annotation, color }, "Annotation")).not.toThrow();
      expect(() => check({ ...file, color })).not.toThrow();
      expect(() => check({ format: "diagrams/v1", title: "Colour", nodes: [], edges: [], color })).not.toThrow();
    },
  );

  it.each(["#12345", "rgb(1,2,3)", "#ggg", { toString: null }, null, 42])(
    "rejects invalid model colours in both schemas: %j",
    (color) => {
      expect(isColorValue(color)).toBe(false);
      expect(() => check({ ...annotation, color }, "Annotation")).toThrow();
      expect(() => check({ ...file, color })).toThrow();
      expect(() => check({ format: "diagrams/v1", title: "Colour", nodes: [], edges: [], color })).toThrow();
    },
  );
  it("covers every field of an edge, including relation and props.settings", () => {
    expect(() => check(edge, "Edge")).not.toThrow();
    expect((defs.Edge.properties as Record<string, JsonSchema>).relation.enum).toEqual(EDGE_RELATIONS);
    expect(() => check({ ...edge, relation: "uses" }, "Edge")).toThrow(/relation/);
    expect(() => check({ ...edge, props: { settings: [{ secret: true }] } }, "Edge")).toThrow(/settings/);
  });

  it("covers every field of the file, its nodes, boundaries, notes and simulations", () => {
    expect(() => check(file)).not.toThrow();
  });

  it("validates annotation colors (predefined including white, and custom hex)", () => {
    expect(() => check({ ...annotation, color: "white" }, "Annotation")).not.toThrow();
    expect(() => check({ ...annotation, color: "#3B82F6" }, "Annotation")).not.toThrow();
    expect(() => check({ ...annotation, color: "#fff" }, "Annotation")).not.toThrow();
    expect(() => check({ ...annotation, color: "invalid-color" }, "Annotation")).toThrow(/match/);
  });

  it("validates diagram color (predefined including white, and custom hex)", () => {
    expect(() => check({ ...file, color: "blue" })).not.toThrow();
    expect(() => check({ ...file, color: "#10b981" })).not.toThrow();
    expect(() => check({ ...file, color: "invalid-color" })).toThrow(/match/);
  });

  it("describes checks: rules turned off and findings ignored, bounded", () => {
    expect(() => check(file.checks, "Checks")).not.toThrow();
    expect(() => check({ ignore: [{ rule: "dead-letter" }] }, "Checks")).toThrow(/target/);
    expect(() => check({ off: ["Dead Letter"] }, "Checks")).toThrow(/match/);
    expect(() => check({ ignore: [{ rule: "capacity", target: "api", reason: "x".repeat(201) }] }, "Checks")).toThrow(
      /reason/,
    );
    expect(() => check({ ignore: [{ rule: "capacity", target: "api", by: "agent" }] }, "Checks")).toThrow(
      /unknown field by/,
    );
  });

  it("is strict enough to notice a field it doesn't describe", () => {
    expect(() => check({ ...edge, weight: 3 }, "Edge")).toThrow(/unknown field weight/);
    expect(() => check({ ...file, theme: "dark" })).toThrow(/unknown field theme/);
    // Simulation props stay open: the engine keeps settings this version doesn't know.
    expect(() => check({ ...node, props: { futureSetting: 1 } }, "Node")).not.toThrow();
  });

  const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
  it.each(Object.entries(examples))("describes every field of the example %s", (_name, example) => {
    expect(() => check(example)).not.toThrow();
  });
});

it.each([undefined, "p1", "p2", "p3", "p3-a1"] as const)(
  "persisted resource schema agrees with native reader for %s",
  (revision) => {
    for (const props of [{ resources: resourceLesson() }, { autoscaling: hpaLesson() }]) {
      for (const where of ["node", "setup", "timeline"]) {
        const d: DiagramFile = {
          format: revision ? "diagrams/v2" : "diagrams/v1",
          ...(revision ? { planning: { revision } } : {}),
          title: "Contract",
          nodes: [
            {
              id: "worker",
              stencil: "service.dotnet",
              label: "Worker",
              x: 0,
              y: 0,
              ...(where === "node" ? { props } : {}),
            },
          ],
          edges: [],
          simulations: [
            {
              id: "sim",
              title: "Contract",
              traffic: [],
              ...(where === "setup" ? { setup: { props: { worker: props } } } : {}),
              ...(where === "timeline"
                ? { timeline: [{ atMs: 0, action: { do: "props", node: "worker", props } }] }
                : {}),
            },
          ],
        };
        const accepted = revision === "p3-a1";
        if (accepted) expect(() => check(d)).not.toThrow();
        else expect(() => check(d)).toThrow();
        expect(parseNative(JSON.stringify(d)).ok).toBe(accepted);
      }
    }
  },
);

it("limits authored node documentation while preserving longer native imports", () => {
  for (const length of [50_000, 50_001]) {
    const node = { id: "api", stencil: "service.go", label: "API", x: 0, y: 0, description: "x".repeat(length) };
    const file = { format: "diagrams/v1", nodes: [node], edges: [] };
    if (length === 50_000) expect(() => check(node, "Node")).not.toThrow();
    else expect(() => check(node, "Node")).toThrow();
    expect(parseNative(JSON.stringify(file)).ok).toBe(true);
  }
});

it("limits authored descriptions while preserving longer native imports", () => {
  for (const length of [2000, 2001]) {
    const file = { format: "diagrams/v1", title: "Runbook", description: "x".repeat(length), nodes: [], edges: [] };
    if (length === 2000) expect(() => check(file)).not.toThrow();
    else expect(() => check(file)).toThrow();
    expect(parseNative(JSON.stringify(file)).ok).toBe(true);
  }
});

it("bounds saved waypoints and closes their point objects", () => {
  expect(() => check({ ...edge, waypoints: [{ x: -100, y: 200 }] }, "Edge")).not.toThrow();
  for (const waypoints of [
    [{ x: 1 }],
    [{ x: 1, y: 2, z: 3 }],
    Array.from({ length: 65 }, () => ({ x: 1, y: 2 })),
    "bad",
  ])
    expect(() => check({ ...edge, waypoints }, "Edge")).toThrow();
});

it("uses the same waypoint coordinate boundaries as native loading", () => {
  for (const value of [-1_000_000, 1_000_000]) {
    const saved = { ...edge, waypoints: [{ x: value, y: -value }] };
    expect(() => check(saved, "Edge")).not.toThrow();
    const result = parseNative(
      JSON.stringify({
        format: "diagrams/v1",
        title: "Bounds",
        nodes: [
          { id: saved.from, stencil: "service.go", label: "A", x: 0, y: 0 },
          { id: saved.to, stencil: "service.go", label: "B", x: 400, y: 0 },
        ],
        edges: [saved],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.diagram.edges[0].waypoints).toEqual(saved.waypoints);
    expect(() => check({ ...saved, waypoints: [{ x: value + Math.sign(value), y: 0 }] }, "Edge")).toThrow();
  }
});
