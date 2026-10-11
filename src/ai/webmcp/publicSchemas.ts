// The static agent docs under public/schema/, built from the code so they can't drift:
//   diagram.v1.json  the .diagram.json file format (src/model/types.ts)
//   ops.v1.json      edit_diagram's input (src/ai/schemas.ts), plus the other tools' inputs
//   stencils.json    the stencil catalog with search aliases (src/stencils/catalog.ts)
// Written by scripts/gen-schemas.mjs before every build; a unit test keeps the committed files current.

import { catalog } from "../../stencils/catalog";
import { STENCIL_ALIASES } from "../../lib/stencilSearch";
import { sharedDefs, toolDescriptions, toolSchemas, opsSchema } from "../index";

export const SITE = "https://www.livediagrams.dev";
const SCHEMA = "https://json-schema.org/draft/2020-12/schema";

const ROLES = ["source", "topic", "queue", "stream", "processor", "gateway", "store", "sink", "none"];
const CATEGORIES = ["messaging", "compute", "data", "network", "observability", "security", "clients", "generic"];
const TONES = (sharedDefs as { Tone: { enum: string[] } }).Tone.enum;
const SIDES = ["top", "right", "bottom", "left"];
const METRICS = ["processed", "backlog", "inFlight", "failed", "deadLettered", "dropped", "throughput", "lag"];
const OPS = ["<", "<=", "==", ">=", ">"];

const num = { type: "number" };
const ms = (description: string) => ({ type: "number", minimum: 0, description });
const str = (maxLength: number, description?: string) => ({
  type: "string",
  maxLength,
  ...(description ? { description } : {}),
});

function diagramSchema() {
  const status = { type: "string", enum: ["up", "paused", "down"] };
  return {
    $schema: SCHEMA,
    $id: `${SITE}/schema/diagram.v1.json`,
    title: "Diagrams file (diagrams/v1)",
    description:
      "A .diagram.json file for Diagrams (https://www.livediagrams.dev). Coordinates are canvas pixels. The app's 'Build with AI' paste box also accepts a file without x/y (it lays the nodes out) and plain-word stencils such as 'Kafka topic'.",
    type: "object",
    required: ["format", "title", "nodes", "edges"],
    properties: {
      format: { const: "diagrams/v1" },
      title: str(200),
      description: str(2000),
      direction: { type: "string", enum: ["LR", "TB"], default: "LR", description: "Main flow direction." },
      nodes: { type: "array", items: { $ref: "#/$defs/Node" } },
      edges: { type: "array", items: { $ref: "#/$defs/Edge" } },
      groups: { type: "array", items: { $ref: "#/$defs/Boundary" }, description: "Boundaries (boxes around nodes)." },
      annotations: { type: "array", items: { $ref: "#/$defs/Annotation" } },
      simulations: { type: "array", items: { $ref: "#/$defs/Simulation" } },
      layerOrder: {
        type: "array",
        items: { type: "string" },
        description: "Back-to-front order of node and annotation ids.",
      },
    },
    $defs: {
      Node: {
        type: "object",
        required: ["id", "stencil", "label", "x", "y"],
        properties: {
          id: { type: "string", minLength: 1 },
          stencil: {
            type: "string",
            description: `A stencil id from ${SITE}/schema/stencils.json, e.g. 'kafka.topic'. Unknown ids render as a generic box.`,
          },
          label: str(200),
          sublabel: str(200, "Second line, e.g. a topic name."),
          x: num,
          y: num,
          group: { type: "string", description: "Id of the boundary it sits in." },
          props: { $ref: "#/$defs/NodeProps" },
        },
      },
      NodeProps: sharedDefs.NodeProps,
      Edge: {
        type: "object",
        required: ["id", "from", "to"],
        properties: {
          id: { type: "string", minLength: 1 },
          from: { type: "string", description: "Node id (or a shape annotation's id)." },
          to: { type: "string" },
          label: str(200),
          kind: {
            type: "string",
            enum: ["async", "sync"],
            default: "async",
            description: "async = messages/events (dashed); sync = request/response (solid).",
          },
          sourceSide: { type: "string", enum: SIDES },
          targetSide: { type: "string", enum: SIDES },
          props: { type: "object" },
        },
      },
      Boundary: {
        type: "object",
        required: ["id", "label", "x", "y", "width", "height"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: str(200),
          tone: { type: "string", enum: TONES },
          x: num,
          y: num,
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 },
        },
      },
      Annotation: {
        type: "object",
        required: ["id", "kind", "text", "x", "y", "width", "height"],
        description: "Documentation only: never part of the simulation.",
        properties: {
          id: { type: "string", minLength: 1 },
          kind: { type: "string", enum: ["text", "note", "zone", "shape"] },
          text: str(2000),
          x: num,
          y: num,
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 },
          shape: { type: "string", enum: ["rect", "rounded", "ellipse", "diamond", "cylinder"] },
          color: { type: "string", enum: ["neutral", "yellow", "green", "blue", "purple", "red"] },
          textSize: { type: "string", enum: ["s", "m", "l", "xl"] },
        },
      },
      Simulation: {
        type: "object",
        required: ["id", "title", "traffic"],
        description: "A saved, scripted run replayed in live view. Times are milliseconds from the start.",
        properties: {
          id: { type: "string", minLength: 1 },
          title: str(200),
          description: str(2000),
          seed: { type: "integer" },
          scale: { type: "number", minimum: 1, description: "Real messages per simulated message." },
          multipliers: { type: "object", properties: { traffic: num, capacity: num } },
          durationMs: ms("Auto-stop after this long."),
          setup: {
            type: "object",
            properties: {
              status: { type: "object", additionalProperties: status },
              props: { type: "object", additionalProperties: { type: "object" } },
            },
          },
          traffic: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "node", "shape"],
              properties: {
                id: { type: "string" },
                node: { type: "string", description: "Node id where messages start." },
                messageType: { type: "string" },
                label: { type: "string" },
                shape: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["kind", "count"],
                      properties: {
                        kind: { const: "burst" },
                        count: { type: "integer", minimum: 1 },
                        atMs: ms(""),
                        spreadMs: ms(""),
                      },
                    },
                    {
                      type: "object",
                      required: ["kind", "ratePerSec", "durationMs"],
                      properties: {
                        kind: { const: "constant" },
                        ratePerSec: ms("per second"),
                        fromMs: ms(""),
                        durationMs: ms(""),
                      },
                    },
                    {
                      type: "object",
                      required: ["kind", "stages"],
                      properties: {
                        kind: { const: "ramp" },
                        fromMs: ms(""),
                        startRate: ms("per second"),
                        stages: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["durationMs", "targetRate"],
                            properties: { durationMs: ms(""), targetRate: ms("per second") },
                          },
                        },
                      },
                    },
                    {
                      type: "object",
                      required: ["kind", "baseRate", "peakRate", "atMs", "peakMs", "durationMs"],
                      properties: {
                        kind: { const: "spike" },
                        baseRate: ms("per second"),
                        peakRate: ms("per second"),
                        atMs: ms(""),
                        peakMs: ms(""),
                        durationMs: ms(""),
                      },
                    },
                  ],
                },
              },
            },
          },
          timeline: {
            type: "array",
            items: {
              type: "object",
              required: ["atMs", "action"],
              properties: {
                atMs: ms(""),
                action: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["do", "node", "status"],
                      properties: { do: { const: "status" }, node: { type: "string" }, status },
                    },
                    {
                      type: "object",
                      required: ["do", "node", "props"],
                      properties: { do: { const: "props" }, node: { type: "string" }, props: { type: "object" } },
                    },
                    {
                      type: "object",
                      required: ["do", "node", "count"],
                      properties: {
                        do: { const: "inject" },
                        node: { type: "string" },
                        count: { type: "integer", minimum: 1 },
                        messageType: { type: "string" },
                        spreadMs: ms(""),
                      },
                    },
                    {
                      type: "object",
                      required: ["do", "text"],
                      properties: {
                        do: { const: "note" },
                        text: str(2000),
                        focus: { type: "array", items: { type: "string" } },
                        pause: { type: "boolean" },
                      },
                    },
                    {
                      type: "object",
                      required: ["do", "node"],
                      properties: { do: { const: "trace" }, node: { type: "string" } },
                    },
                  ],
                },
              },
            },
          },
          expectations: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label", "metric", "op", "value"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                metric: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["node", "field"],
                      properties: {
                        node: { type: "string" },
                        field: { type: "string", enum: METRICS },
                        group: { type: "string" },
                      },
                    },
                    { type: "object", required: ["system"], properties: { system: { const: "inSystem" } } },
                  ],
                },
                op: { type: "string", enum: OPS },
                value: num,
                when: { type: "string", enum: ["always", "eventually", "end", "at"], default: "end" },
                atMs: ms(""),
              },
            },
          },
        },
      },
    },
  };
}

function opsDoc() {
  return {
    $schema: SCHEMA,
    $id: `${SITE}/schema/ops.v1.json`,
    title: "Diagrams edit ops (v1)",
    description: `${toolDescriptions.edit_diagram} The same input as the WebMCP tool edit_diagram and the 'Build with AI' paste box (which also takes a bare array of ops).`,
    ...opsSchema,
    $comment: "The other tools' inputs are under $tools.",
    $tools: Object.fromEntries(
      Object.entries(toolSchemas).map(([name, schema]) => [
        name,
        { description: toolDescriptions[name as keyof typeof toolDescriptions], inputSchema: schema },
      ]),
    ),
  };
}

function stencilsDoc() {
  return {
    $comment: "Stencil ids are a public contract: never renamed. Use 'kind' in plain words or an id from here.",
    categories: CATEGORIES,
    simRoles: ROLES,
    stencils: catalog.map((s) => ({
      id: s.id,
      label: s.label,
      vendor: s.vendor,
      category: s.category,
      simRole: s.simRole,
      description: s.description,
      ...(STENCIL_ALIASES[s.id]?.length ? { aliases: [...STENCIL_ALIASES[s.id]] } : {}),
    })),
  };
}

/** File name (under public/schema/) → JSON text. */
export function publicSchemaFiles(): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  return {
    "diagram.v1.json": json(diagramSchema()),
    "ops.v1.json": json(opsDoc()),
    "stencils.json": json(stencilsDoc()),
  };
}
