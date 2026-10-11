// JSON Schema draft 2020-12. Shared by paste, WebMCP and static schema generation.
import { aiNodePropsSchema, simPropsPatchSchema } from "../model/simProps";
export type { JsonSchema } from "../model/jsonSchema";
import type { JsonSchema } from "../model/jsonSchema";
/** An agent's note for the person, on every tool that changes the diagram: shown with the change. */
const summaryField = {
  type: "string",
  maxLength: 200,
  description:
    "One short sentence for the person, e.g. 'Added a Redis cache in front of orders-db'. Shown with the change in the app's AI panel.",
} as const;

export const sharedDefs = {
  Ref: {
    type: "string",
    minLength: 1,
    maxLength: 200,
    description:
      "An element: id from describe_diagram (preferred), a key set earlier in this call, an exact label, 'label (sublabel)', or for a connection 'From -> To'.",
  },
  NodeProps: aiNodePropsSchema,
  Tone: {
    type: "string",
    enum: ["azure", "aws", "gcp", "k8s", "onprem", "neutral"],
  },
  PropsPatch: simPropsPatchSchema,
};
export const describe_diagramSchema: JsonSchema = {
  ...{
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["text", "json"],
        default: "text",
      },
      focus: {
        type: "array",
        items: {
          $ref: "#/$defs/Ref",
        },
        maxItems: 20,
        description: "Only these elements and their direct neighbours.",
      },
      limit: {
        type: "integer",
        minimum: 10,
        maximum: 500,
        default: 150,
        description: "Max lines.",
      },
    },
  },
  $defs: sharedDefs,
};
export const find_stencilsSchema: JsonSchema = {
  ...{
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Free text, e.g. '.NET consumer', 'service bus queue'.",
      },
      category: {
        type: "string",
        enum: ["messaging", "compute", "data", "network", "observability", "security", "clients", "generic"],
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        default: 5,
      },
    },
  },
  $defs: sharedDefs,
};
export const edit_diagramSchema: JsonSchema = {
  ...{
    type: "object",
    required: ["ops"],
    properties: {
      ops: {
        type: "array",
        minItems: 0,
        description: "Use an empty list only with layout: full to rearrange the existing diagram.",
        maxItems: 100,
        items: {
          oneOf: [
            {
              type: "object",
              required: ["op", "kind", "label"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "add_node",
                },
                kind: {
                  type: "string",
                  maxLength: 100,
                  description: "Plain words or a stencil id, e.g. 'Kafka topic', 'service.dotnet'.",
                },
                label: {
                  type: "string",
                  maxLength: 200,
                },
                sublabel: {
                  type: "string",
                  maxLength: 200,
                  description: "Second line, e.g. a topic name 'orders.created'.",
                },
                key: {
                  type: "string",
                  maxLength: 50,
                  description: "Name to refer to this node later in the same call.",
                },
                in: {
                  $ref: "#/$defs/Ref",
                  description: "Boundary to place it in.",
                },
                props: {
                  $ref: "#/$defs/NodeProps",
                },
              },
            },
            {
              type: "object",
              required: ["op", "from", "to"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "connect",
                },
                from: {
                  $ref: "#/$defs/Ref",
                },
                to: {
                  $ref: "#/$defs/Ref",
                },
                label: {
                  type: "string",
                  maxLength: 200,
                },
                kind: {
                  type: "string",
                  enum: ["async", "sync"],
                  default: "async",
                  description: "async = messages/events; sync = request/response, writes to a database.",
                },
                key: {
                  type: "string",
                  minLength: 1,
                  maxLength: 50,
                },
              },
            },
            {
              type: "object",
              required: ["op", "target"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "update",
                },
                target: {
                  $ref: "#/$defs/Ref",
                },
                label: {
                  type: "string",
                  maxLength: 200,
                },
                sublabel: {
                  type: ["string", "null"],
                  maxLength: 200,
                },
                kind: {
                  type: "string",
                  maxLength: 100,
                  description: "Nodes: change the stencil. Connections: 'async' or 'sync'.",
                },
                in: {
                  type: ["string", "null"],
                  description: "Move into this boundary; null removes it from its boundary.",
                },
                props: {
                  $ref: "#/$defs/PropsPatch",
                },
                members: {
                  type: "array",
                  items: {
                    $ref: "#/$defs/Ref",
                  },
                },
                tone: {
                  $ref: "#/$defs/Tone",
                },
              },
            },
            {
              type: "object",
              required: ["op", "targets"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "remove",
                },
                targets: {
                  type: "array",
                  minItems: 1,
                  maxItems: 100,
                  items: {
                    $ref: "#/$defs/Ref",
                  },
                  description: "Nodes, connections ('A -> B'), boundaries (contents are kept) or notes.",
                },
              },
            },
            {
              type: "object",
              required: ["op", "label", "members"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "add_boundary",
                },
                label: {
                  type: "string",
                  maxLength: 200,
                },
                members: {
                  type: "array",
                  minItems: 1,
                  items: {
                    $ref: "#/$defs/Ref",
                  },
                },
                tone: {
                  $ref: "#/$defs/Tone",
                },
                key: {
                  type: "string",
                  maxLength: 50,
                },
              },
            },
            {
              type: "object",
              required: ["op", "text"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "add_note",
                },
                text: {
                  type: "string",
                  maxLength: 2000,
                },
                style: {
                  type: "string",
                  enum: ["note", "text"],
                  default: "note",
                },
                near: {
                  $ref: "#/$defs/Ref",
                },
                key: {
                  type: "string",
                  minLength: 1,
                  maxLength: 50,
                },
              },
            },
            {
              type: "object",
              required: ["op"],
              additionalProperties: false,
              properties: {
                op: {
                  const: "set_meta",
                },
                title: {
                  type: "string",
                  maxLength: 200,
                },
                description: {
                  type: "string",
                  maxLength: 2000,
                },
                direction: {
                  type: "string",
                  enum: ["LR", "TB"],
                },
              },
            },
          ],
        },
      },
      layout: {
        type: "string",
        enum: ["auto", "full", "none"],
        default: "auto",
      },
      dryRun: {
        type: "boolean",
        default: false,
        description: "Validate and report without changing the diagram.",
      },
      summary: summaryField,
    },
  },
  $defs: sharedDefs,
};
export const set_simulationSchema: JsonSchema = {
  ...{
    type: "object",
    required: ["title", "traffic"],
    properties: {
      title: {
        type: "string",
        maxLength: 200,
      },
      summary: summaryField,
      replace: {
        $ref: "#/$defs/Ref",
        description: "Existing simulation id or title to overwrite; omitted = add new.",
      },
      durationSec: {
        type: "number",
        minimum: 1,
        maximum: 3600,
      },
      traffic: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          required: ["from", "pattern"],
          additionalProperties: false,
          properties: {
            from: {
              $ref: "#/$defs/Ref",
            },
            pattern: {
              type: "string",
              enum: ["constant", "burst", "ramp", "spike"],
            },
            ratePerSec: {
              type: "number",
              minimum: 0,
              description: "constant; ramp start; spike base.",
            },
            toRatePerSec: {
              type: "number",
              minimum: 0,
              description: "ramp target; spike peak.",
            },
            count: {
              type: "integer",
              minimum: 1,
              description: "burst size.",
            },
            startSec: {
              type: "number",
              minimum: 0,
              default: 0,
            },
            durationSec: {
              type: "number",
              minimum: 0,
              description: "constant/ramp/spike length; burst spread.",
            },
            peakSec: {
              type: "number",
              minimum: 0,
              description: "spike: how long the peak lasts.",
            },
            messageType: {
              type: "string",
            },
            label: {
              type: "string",
            },
          },
        },
      },
      events: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          required: ["atSec", "node", "do"],
          additionalProperties: false,
          properties: {
            atSec: {
              type: "number",
              minimum: 0,
            },
            node: {
              $ref: "#/$defs/Ref",
            },
            do: {
              type: "string",
              enum: ["down", "up", "pause", "slow", "set"],
            },
            latencyMs: {
              type: "number",
              minimum: 0,
              description: "for 'slow'.",
            },
            props: {
              $ref: "#/$defs/NodeProps",
              description: "for 'set'.",
            },
            note: {
              type: "string",
              maxLength: 300,
              description: "Optional narration shown at this time.",
            },
          },
        },
      },
      expectations: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          required: ["label", "metric", "op", "value"],
          additionalProperties: false,
          properties: {
            label: {
              type: "string",
            },
            node: {
              $ref: "#/$defs/Ref",
              description: "Omit with metric 'inSystem'.",
            },
            metric: {
              type: "string",
              enum: [
                "processed",
                "backlog",
                "inFlight",
                "failed",
                "deadLettered",
                "dropped",
                "throughput",
                "lag",
                "inSystem",
              ],
            },
            op: {
              type: "string",
              enum: ["<", "<=", "==", ">=", ">"],
            },
            value: {
              type: "number",
            },
            when: {
              type: "string",
              enum: ["always", "eventually", "end"],
              default: "end",
            },
          },
        },
      },
    },
  },
  $defs: sharedDefs,
};
export const new_diagramSchema: JsonSchema = {
  ...{
    type: "object",
    properties: {
      title: {
        type: "string",
        maxLength: 200,
      },
      direction: {
        type: "string",
        enum: ["LR", "TB"],
        default: "LR",
      },
      summary: summaryField,
    },
  },
  $defs: sharedDefs,
};
export const get_share_linkSchema: JsonSchema = {
  ...{
    type: "object",
    properties: {},
  },
  $defs: sharedDefs,
};
export const toolSchemas = {
  describe_diagram: describe_diagramSchema,
  find_stencils: find_stencilsSchema,
  edit_diagram: edit_diagramSchema,
  set_simulation: set_simulationSchema,
  new_diagram: new_diagramSchema,
  get_share_link: get_share_linkSchema,
};
export const toolDescriptions = {
  describe_diagram:
    "Read the current diagram as compact text: nodes with ids, kinds and labels, connections, boundaries and simulations. Call before editing an existing diagram.",
  find_stencils:
    "Search the stencil catalog (Kafka, Azure, AWS, GCP, databases, services…). Use when edit_diagram reported low confidence for a kind.",
  edit_diagram:
    "Add, connect, change or remove diagram elements in one atomic step (one undo). Describe kinds in plain words ('.NET consumer', 'Kafka topic'); the app picks the icon and position. Put a whole request in one call.",
  set_simulation:
    "Create or replace a simulation in plain units: who sends how much traffic, what breaks when, and what should hold true. Times are seconds.",
  new_diagram: "Start a new, empty diagram. The current one stays in the library.",
  get_share_link:
    "Get a link that opens the current diagram. The diagram is stored in the link itself; nothing is uploaded.",
};
export const opsSchema = edit_diagramSchema;
const variants = (edit_diagramSchema.properties as Record<string, Record<string, unknown>>).ops.items as {
  oneOf: { properties: Record<string, unknown> }[];
};
export const flatOpsSchema: JsonSchema = {
  ...edit_diagramSchema,
  properties: {
    ...(edit_diagramSchema.properties as object),
    ops: {
      type: "array",
      items: {
        type: "object",
        required: ["op"],
        additionalProperties: false,
        properties: {
          ...Object.assign({}, ...variants.oneOf.map((v) => v.properties)),
          op: { type: "string", enum: variants.oneOf.map((v) => (v.properties.op as { const: string }).const) },
          kind: { type: "string", maxLength: 100 },
        },
      },
    },
  },
};

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}
/** Decision 8: labels are user-authored, so anything echoing them is untrusted content. */
export const toolAnnotations: Record<keyof typeof toolSchemas, ToolAnnotations> = {
  describe_diagram: { readOnlyHint: true, untrustedContentHint: true },
  find_stencils: { readOnlyHint: true },
  edit_diagram: { untrustedContentHint: true },
  set_simulation: {},
  new_diagram: { consequentialHint: true },
  get_share_link: { readOnlyHint: true },
};

export { diagramV1Schema } from "../model/diagramSchema";
