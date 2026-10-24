import { METRIC_FIELDS } from "../model/types";
import { faultSchema, DRILL_PRESETS } from "../model/faults";
import { requestRoutesSchema } from "../model/requestRouting";
// JSON Schema draft 2020-12. Shared by paste, WebMCP and static schema generation.
import { aiNodePropsSchema, simPropsPatchSchema } from "../model/simProps";
import { CHECK_RULES } from "../model/checks";
import { EDGE_RELATIONS } from "../model/relations";
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
  Side: { type: "string", enum: ["top", "right", "bottom", "left"] },
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
export const check_diagramSchema: JsonSchema = {
  ...{
    type: "object",
    properties: {
      rules: {
        type: "array",
        items: { type: "string", enum: [...CHECK_RULES] },
        maxItems: CHECK_RULES.length,
        description:
          "Only these checks (default: all): dead-letter (failed messages are dropped), no-reader (nobody reads a topic or queue), sync-cycle (requests go round in a circle), message-loop (a message type is forwarded around a processor cycle; retries and broker redelivery excluded), sync-chain (requests chained too deep), shared-database (a service uses another's database), entry-gateway (a client goes around the gateway), capacity (a service can't keep up at the diagram's rates), blocked-threads (waiting calls exhaust threads), scaling-blind (CPU scaling misses waiting threads), call-timeout (an outside or model API call has no deadline), single-point (every request goes through one replica), secret-identity (services read secrets without an identity), schema-registry (Avro or Protobuf on Kafka without a schema registry), dropped (messages a saved simulation loses that no other check explains; only with simulations: true, and never with a fix).",
      },
      include: {
        type: "string",
        enum: ["warnings", "all"],
        default: "all",
        description: "warnings: likely real problems only; all: suggestions too.",
      },
      simulations: {
        type: "boolean",
        default: false,
        description:
          "Also play the diagram's saved simulations (each at most 60 s of simulated time, all within about 15 s) and report the messages they lose: counts on findings, and dropped findings. Losses a simulation causes on purpose aren't findings.",
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
        enum: ["messaging", "compute", "data", "network", "onprem", "observability", "security", "clients", "generic"],
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
                  description:
                    "async = messages/events; sync = request/response, writes to a database. Left out: sync into a database, gateway, outside or model API, or out of a client or gateway; async into or out of a queue, topic or stream, and otherwise.",
                },
                relation: {
                  type: "string",
                  enum: EDGE_RELATIONS,
                  description:
                    "Left out: infer from the stencils as in the editor (e.g. into Key Vault: secret; otherwise a flow). An explicit relation wins; flow carries traffic, while config, secret, identity, telemetry, deploy and depends are dotted dependencies with no traffic.",
                },
                fromSide: { $ref: "#/$defs/Side", description: "Fix the source end to this side." },
                toSide: { $ref: "#/$defs/Side", description: "Fix the target end to this side." },
                key: {
                  type: "string",
                  minLength: 1,
                  maxLength: 50,
                },
              },
            },
            {
              type: "object",
              required: ["op", "from", "to", "kind", "label"],
              additionalProperties: false,
              description:
                "Put a new node on the connection from -> to: it becomes from -> new -> to. Both new connections keep the old one's kind, relation and props; its label and source side go on the first, its target side on the second. Hand-shaped routes are reset.",
              properties: {
                op: {
                  const: "insert_between",
                },
                from: {
                  $ref: "#/$defs/Ref",
                },
                to: {
                  $ref: "#/$defs/Ref",
                },
                kind: {
                  type: "string",
                  maxLength: 100,
                  description: "Plain words or a stencil id, e.g. 'Redis cache'.",
                },
                label: {
                  type: "string",
                  maxLength: 200,
                },
                sublabel: {
                  type: "string",
                  maxLength: 200,
                },
                key: {
                  type: "string",
                  maxLength: 50,
                  description: "Name to refer to the new node later in the same call.",
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
                  description:
                    "Nodes: change the stencil; its connections' relationships follow, as on the canvas (a flow into what becomes a config store turns config; an inferred dependency into what stops being one turns back into a flow), listed in the result's relations. Connections: 'async' or 'sync'.",
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
                fromSide: {
                  anyOf: [{ $ref: "#/$defs/Side" }, { type: "null" }],
                  description: "Connections only: source side; null restores automatic side selection.",
                },
                toSide: {
                  anyOf: [{ $ref: "#/$defs/Side" }, { type: "null" }],
                  description: "Connections only: target side; null restores automatic side selection.",
                },
                route: {
                  type: "string",
                  enum: ["auto"],
                  description: "Connections only: reset a hand-shaped route. Agents never write bend coordinates.",
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
                requestRoutes: {
                  ...requestRoutesSchema,
                  description:
                    "Request routing (current planning model): the diagram's complete list of request routes, each an id and a method/path address. Replaces the list; mixes (props.trafficMix), caller addresses (connection props.requestRouteId) and route tables (props.routeTable on an HTTP router) refer to these ids.",
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
        minItems: 0,
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
      faults: {
        type: "array",
        maxItems: 50,
        description:
          "Saved drill timeline: boundary outages, node slowdown/failure overlays and cross-boundary flow partitions. Restore with down/cut false, factor 1 or rate 0. Targets are ids or exact labels from describe_diagram. Requests over cut links fail; brokers retain queued messages.",
        items: {
          type: "object",
          required: ["atSec", "fault"],
          additionalProperties: false,
          properties: {
            atSec: { type: "number", minimum: 0 },
            fault: faultSchema,
            drill: { enum: [...DRILL_PRESETS] },
            note: { type: "string", maxLength: 300 },
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
              enum: [...METRIC_FIELDS, "inSystem"],
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
  check_diagram: check_diagramSchema,
  find_stencils: find_stencilsSchema,
  edit_diagram: edit_diagramSchema,
  set_simulation: set_simulationSchema,
  new_diagram: new_diagramSchema,
  get_share_link: get_share_linkSchema,
};
export const toolDescriptions = {
  describe_diagram:
    "Read the current diagram as compact text: nodes with ids, kinds, labels and arriving message types, carried types per connection, waiting callers' threads, hold time and ceiling, connections, boundaries and simulations. Call before editing an existing diagram.",
  check_diagram:
    "Find likely design problems in the current diagram (failed messages that are dropped, topics nobody reads, message types forwarded around a processor loop, requests that go round in a circle or chain too deep, a service using another's database, a client going around the gateway, a service that can't keep up or that every request goes through, threads exhausted by calls, CPU scaling blind to waits, or outside/model API calls with no timeout), each naming its elements and, where one exists, a fix as edit_diagram ops. Read-only: apply a fix by sending its ops to edit_diagram. Findings the person ignored aren't listed; only the person can ignore one. With simulations: true it also plays the saved simulations and counts the messages they lose: what happened and where, never a fix (slower: seconds on a large diagram).",
  find_stencils:
    "Search the stencil catalog (Kafka, Azure, AWS, GCP, databases, services…). Use when edit_diagram reported low confidence for a kind.",
  edit_diagram:
    "Add, connect, change or remove diagram elements in one atomic step (one undo). Describe kinds in plain words ('.NET consumer', 'Kafka topic'); the app picks the icon and position. Put a whole request in one call.",
  set_simulation:
    "Create or replace a simulation in plain units: who sends how much traffic, what breaks when, and what should hold true. Times are seconds. Use faults for named drills: zone-outage, region-connectivity, slow-dependency or error-spike. Faults can take down a boundary, slow a node, inject failures or cut a flow between boundaries; use another fault step to restore it.",
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
  check_diagram: { readOnlyHint: true, untrustedContentHint: true },
  find_stencils: { readOnlyHint: true },
  edit_diagram: { untrustedContentHint: true },
  set_simulation: {},
  new_diagram: { consequentialHint: true },
  get_share_link: { readOnlyHint: true },
};

export { diagramV1Schema } from "../model/diagramSchema";
