import { describe, expect, it } from "vitest";
import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import { diagramV1Schema } from "./diagramSchema";
import { EDGE_RELATIONS } from "./relations";
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
const defs = schema.$defs as Record<string, JsonSchema>;
const check = (value: unknown, def?: string) => checkJsonSchema(value, def ? defs[def] : schema, def ?? "file", defs);

const node: Required<DiagramNode> = {
  id: "api",
  stencil: "service.dotnet",
  label: "API",
  sublabel: "orders",
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
  sourceSide: "right",
  targetSide: "left",
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
  format: "diagrams/v1",
  title: "Everything",
  description: "Every field the format has.",
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
  it("covers every field of an edge, including relation and props.settings", () => {
    expect(() => check(edge, "Edge")).not.toThrow();
    expect((defs.Edge.properties as Record<string, JsonSchema>).relation.enum).toEqual(EDGE_RELATIONS);
    expect(() => check({ ...edge, relation: "uses" }, "Edge")).toThrow(/relation/);
    expect(() => check({ ...edge, props: { settings: [{ secret: true }] } }, "Edge")).toThrow(/settings/);
  });

  it("covers every field of the file, its nodes, boundaries, notes and simulations", () => {
    expect(() => check(file)).not.toThrow();
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
