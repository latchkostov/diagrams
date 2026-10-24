// AI authoring contracts are built on first AI use; native file validation keeps its original grammar.
import type { JsonSchema } from "./jsonSchema";
import { cardinality, nodeSimPropsSchema, nodeProperties, edgeProperties } from "./simProps";

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
        : "oneOf" in schema
          ? { anyOf: [schema, { type: "null" }] }
          : {
              ...schema,
              type: [schema.type, "null"],
              ...("enum" in schema ? { enum: [...(schema.enum as unknown[]), null] } : {}),
            },
    ]),
  ),
};
