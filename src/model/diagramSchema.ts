import { nodeSimPropsSchema, edgeSimPropsSchema } from "./simProps";
import { EDGE_RELATIONS, MAX_SETTINGS, MAX_SETTING_KEY } from "./relations";
import { CHECK_LIMITS, CHECK_RULE_ID } from "./checks";
import type { JsonSchema } from "./jsonSchema";
import type {
  CheckIgnore,
  DiagramChecks,
  DiagramAnnotation,
  DiagramEdge,
  DiagramFile,
  DiagramGroup,
  DiagramNode,
  Simulation,
} from "./types";

// Every field of the file format, its nodes, edges, boundaries, notes and simulations is listed here:
// `satisfies Fields<T>` fails typecheck when a type gains a field the schema doesn't describe, and
// diagramSchema.test.ts checks every example against the schema with unknown fields refused.
type Fields<T> = Record<keyof T, JsonSchema>;
const SITE = "https://www.livediagrams.dev";
const SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const TONES = ["azure", "aws", "gcp", "k8s", "onprem", "neutral"];
const SIDES = ["top", "right", "bottom", "left"];
const METRICS = ["processed", "backlog", "inFlight", "failed", "deadLettered", "dropped", "throughput", "lag"];
const OPS = ["<", "<=", "==", ">=", ">"];

const num = { type: "number" };
const ID = {
  type: "string",
  minLength: 1,
  description: "Unique across nodes, edges, boundaries and annotations: they share one id space.",
};
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
    title: "Live Diagrams file (diagrams/v1)",
    description:
      "A .diagram.json file for Live Diagrams (https://www.livediagrams.dev). Coordinates are canvas pixels. The AI panel's Advanced paste box also accepts a file without x/y (it lays the nodes out) and plain-word stencils such as 'Kafka topic'.",
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
      private: {
        type: "boolean",
        description:
          "true for a Private diagram: the app keeps it on the device (no share links, no cloud saves, no AI tools) and it stays private when opened again. Agents must not share or upload a file that has it.",
      },
      checks: { $ref: "#/$defs/Checks" },
    } satisfies Fields<DiagramFile>,
    $defs: {
      Checks: {
        type: "object",
        description:
          "Architecture checks a person turned off or ignored for this diagram. Only people change it: agents report findings (check_diagram) and fix them, never silence them.",
        properties: {
          off: {
            type: "array",
            maxItems: CHECK_LIMITS.maxOff,
            items: { type: "string", pattern: CHECK_RULE_ID.source },
            description: "Rule ids turned off for this diagram, e.g. 'dead-letter'.",
          },
          ignore: {
            type: "array",
            maxItems: CHECK_LIMITS.maxIgnores,
            items: {
              type: "object",
              required: ["rule", "target"],
              properties: {
                rule: { type: "string", pattern: CHECK_RULE_ID.source },
                target: {
                  type: "string",
                  minLength: 1,
                  maxLength: CHECK_LIMITS.maxTarget,
                  description: "The finding's element id. Dropped when that element is removed.",
                },
                reason: str(CHECK_LIMITS.maxReason, "Why it's fine here."),
              } satisfies Fields<CheckIgnore>,
            },
          },
        } satisfies Fields<DiagramChecks>,
      },
      Node: {
        type: "object",
        required: ["id", "stencil", "label", "x", "y"],
        properties: {
          id: ID,
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
        } satisfies Fields<DiagramNode>,
      },
      NodeProps: nodeSimPropsSchema,
      Edge: {
        type: "object",
        required: ["id", "from", "to"],
        properties: {
          id: ID,
          from: { type: "string", description: "Node id (or a shape annotation's id)." },
          to: { type: "string" },
          label: str(200),
          kind: {
            type: "string",
            enum: ["async", "sync"],
            default: "async",
            description:
              "async = messages/events (dashed); sync = request/response (solid). Only meaningful for flows.",
          },
          relation: {
            type: "string",
            enum: EDGE_RELATIONS,
            default: "flow",
            description:
              "What the connection means. flow carries messages or requests; the others are dependencies (dotted, no traffic, ignored by the simulation) and point from the thing that needs it to the dependency: config, secret, identity (gets tokens from), telemetry (reports to), deploy (from the actor to its target), depends.",
          },
          sourceSide: {
            type: "string",
            enum: SIDES,
            description: "Side of the from node it attaches to. Omitted = chosen from the positions.",
          },
          targetSide: { type: "string", enum: SIDES, description: "Side of the to node it attaches to." },
          props: { $ref: "#/$defs/EdgeProps" },
        } satisfies Fields<DiagramEdge>,
      },
      EdgeProps: {
        ...edgeSimPropsSchema,
        properties: {
          ...(edgeSimPropsSchema.properties as Record<string, JsonSchema>),
          settings: {
            type: "array",
            maxItems: MAX_SETTINGS,
            description:
              "Config connections only: the settings it reads. secret = the value is a reference to a secret store (e.g. a Key Vault reference). Names only, never values.",
            items: {
              type: "object",
              required: ["key"],
              properties: { key: str(MAX_SETTING_KEY), secret: { type: "boolean" } },
            },
          },
        },
      },
      Boundary: {
        type: "object",
        required: ["id", "label", "x", "y", "width", "height"],
        properties: {
          id: ID,
          label: str(200),
          tone: { type: "string", enum: TONES },
          x: num,
          y: num,
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 },
        } satisfies Fields<DiagramGroup>,
      },
      Annotation: {
        type: "object",
        required: ["id", "kind", "text", "x", "y", "width", "height"],
        description: "Documentation only: never part of the simulation.",
        properties: {
          id: ID,
          kind: { type: "string", enum: ["text", "note", "zone", "shape"] },
          text: str(2000),
          x: num,
          y: num,
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 },
          shape: { type: "string", enum: ["rect", "rounded", "ellipse", "diamond", "cylinder"] },
          color: { type: "string", enum: ["neutral", "yellow", "green", "blue", "purple", "red"] },
          textSize: { type: "string", enum: ["s", "m", "l", "xl"] },
        } satisfies Fields<DiagramAnnotation>,
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
              props: { type: "object", additionalProperties: { $ref: "#/$defs/NodeProps" } },
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
                      properties: {
                        do: { const: "props" },
                        node: { type: "string" },
                        props: { $ref: "#/$defs/NodeProps" },
                      },
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
        } satisfies Fields<Simulation>,
      },
    },
  };
}

export const diagramV1Schema = diagramSchema();
