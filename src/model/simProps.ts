import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import type { NodeSimProps, EdgeSimProps } from "../sim/types";

const quantity = { type: "number", minimum: 0, maximum: 10_000 };
const cardinality = { type: "integer", minimum: 1, maximum: 10_000 };
const time = { type: "number", minimum: 0, maximum: 600_000 };
const fraction = { type: "number", minimum: 0, maximum: 1 };
// Field coverage is checked against the engine interfaces by TypeScript.
const nodeProperties = {
  ratePerSec: quantity,
  latencyMs: time,
  concurrency: quantity,
  replicas: quantity,
  jitter: fraction,
  failureRate: fraction,
  retry: { type: "string", enum: ["requeue", "inplace"] },
  retryBackoffMs: time,
  maxDeliveryCount: quantity,
  partitions: quantity,
  messageType: { type: "string" },
  emits: { anyOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "string" } }] },
} satisfies Record<keyof NodeSimProps, JsonSchema>;
const edgeProperties = {
  group: { type: "string" },
  share: fraction,
  dlq: { type: "boolean" },
  travelMs: time,
  emits: { type: "string" },
  filter: { type: "array", items: { type: "string" } },
} satisfies Record<keyof EdgeSimProps, JsonSchema>;
export const nodeSimPropsSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: nodeProperties,
};
export const edgeSimPropsSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: edgeProperties,
};
// Native files preserve engine settings such as zero concurrency. AI suggestions use positive
// integer counts, retaining the existing input constraints without duplicating property definitions.
const aiProperties = {
  ...nodeProperties,
  concurrency: cardinality,
  replicas: cardinality,
  maxDeliveryCount: cardinality,
  partitions: cardinality,
};
export const aiNodePropsSchema: JsonSchema = { ...nodeSimPropsSchema, properties: aiProperties };
/** update targets either nodes or connections; null deletes any known setting. */
export const simPropsPatchSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: Object.fromEntries(
    Object.entries({ ...edgeProperties, ...aiProperties }).map(([key, schema]) => [
      key,
      "anyOf" in schema
        ? { anyOf: [...(schema.anyOf as JsonSchema[]), { type: "null" }] }
        : {
            ...schema,
            type: [schema.type, "null"],
            ...("enum" in schema ? { enum: [...(schema.enum as unknown[]), null] } : {}),
          },
    ]),
  ),
};
export function propsProblem(value: unknown): boolean {
  try {
    checkJsonSchema(value, nodeSimPropsSchema);
    return false;
  } catch {
    return true;
  }
}
