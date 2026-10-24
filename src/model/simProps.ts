import { resourcesSchema, autoscalingSchema, checkAutoscaling } from "./autoscalingSchema";
import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import type { NodeSimProps, EdgeSimProps } from "../sim/types";
import { apiSchema, endpointsSchema, callerSchema, checkEndpoints, checkApi } from "./admissionSchema";
import { SIM_LIMITS } from "./simLimits";
import {
  checkRouteTable,
  checkTrafficMix,
  routeMatchSchema,
  routeTableSchema,
  trafficMixSchema,
} from "./requestRouting";

export { SIM_LIMITS };
const ADMISSION_PRESET_IDS = [
  "lambda-account",
  "stripe-live",
  "stripe-sandbox",
  "api-gateway-account",
  "managed-measured",
];
const ADMISSION_REVISION = "2026-10-14";

/** Compatibility is shared by files and clipboard fragments, including saved patches. */
export function unsupportedPreset(props: unknown): boolean {
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;
  const p = props as Record<string, unknown>;
  if (p.preset === undefined && p.presetRevision === undefined) return false;
  if (typeof p.preset === "string" && ADMISSION_PRESET_IDS.includes(p.preset))
    return p.presetRevision !== ADMISSION_REVISION;
  return (p.preset !== "processor-lesson" && p.preset !== "device-size") || p.presetRevision !== "1";
}

const rate = { type: "number", minimum: 0, maximum: SIM_LIMITS.ratePerSec };
const quantity = { type: "number", minimum: 0, maximum: SIM_LIMITS.count };
export const cardinality = { type: "integer", minimum: 1, maximum: SIM_LIMITS.count };
const time = { type: "number", minimum: 0, maximum: SIM_LIMITS.timeMs };
const fraction = { type: "number", minimum: 0, maximum: 1 };
// Field coverage is checked against the engine interfaces by TypeScript.
export const queueSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 1_000_000 },
    whenFull: { type: "string", enum: ["reject-new", "drop-oldest"] },
    order: { type: "string", enum: ["fifo", "lifo"] },
    maxWaitMs: time,
  },
};
export const nodeProperties = {
  queue: queueSchema,
  resources: resourcesSchema,
  autoscaling: autoscalingSchema,
  resumeAutoscaling: { type: "boolean" },
  api: apiSchema,
  endpoints: endpointsSchema,
  scaling: { type: "string", enum: ["fixed", "auto"] },
  maxConcurrency: quantity,
  preset: { type: "string", enum: ["processor-lesson", "device-size", ...ADMISSION_PRESET_IDS] },
  presetRevision: { type: "string", enum: ["1", ADMISSION_REVISION] },
  connections: cardinality,
  querySlots: cardinality,
  ingestUnits: cardinality,
  ratePerSec: rate,
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
  size: { type: "string", enum: ["branch", "campus", "datacentre"] },
  gbps: { type: "number", minimum: 0, maximum: 1_000_000 },
  messageKB: { type: "number", minimum: 0.01, maximum: 1_000_000 },
  ha: { type: "string", enum: ["standalone", "active-standby", "active-active"] },
  failoverMs: time,
  healthChecks: { type: "boolean" },
  trafficMix: trafficMixSchema,
  routeTable: routeTableSchema,
} satisfies Record<keyof NodeSimProps, JsonSchema>;
export const edgeProperties = {
  priority: { type: "string", enum: ["critical", "normal", "sheddable"] },
  requestRouteId: { type: "string", minLength: 1, maxLength: 200 },
  requestFilter: routeMatchSchema,
  endpointId: { type: "string", minLength: 1, maxLength: 200 },
  caller: callerSchema,
  group: { type: "string" },
  groupOrigin: { type: "string", enum: ["inferred"] },
  share: fraction,
  dlq: { type: "boolean" },
  travelMs: time,
  networkDelayMs: time,
  emits: { type: "string" },
  filter: { type: "array", items: { type: "string" } },
  deny: { type: "boolean" },
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
export function invalidEndpointReference(props: unknown): boolean {
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;
  const value = (props as Record<string, unknown>).endpointId;
  if (value === undefined) return false;
  try {
    checkJsonSchema(value, edgeProperties.endpointId, "endpointId");
    return false;
  } catch {
    return true;
  }
}

/** P1 edge metadata uses the same bounds at both file and clipboard boundaries. */
export function invalidPlanningDelay(props: unknown): boolean {
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;
  const value = (props as Record<string, unknown>).networkDelayMs;
  if (value === undefined) return false;
  try {
    checkJsonSchema(value, edgeProperties.networkDelayMs, "networkDelayMs");
    return false;
  } catch {
    return true;
  }
}
const number = (n: number) => n.toLocaleString("en-US");

/**
 * What's wrong with a node's simulation settings, naming the field and the limit ("ratePerSec 20,000,000 is over
 * the 10,000,000 limit"), or undefined when they're fine.
 */
export function propsProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "props must be an object";
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined || !Object.hasOwn(nodeProperties, key)) continue;
    const schema: JsonSchema = nodeProperties[key as keyof typeof nodeProperties];
    try {
      if (key === "endpoints") checkEndpoints(field);
      else if (key === "api") checkApi(field);
      else if (key === "trafficMix" || key === "routeTable") {
        // Routing records have their own grammar; their messages name the field and the bound.
        if (key === "trafficMix") checkTrafficMix(field);
        else checkRouteTable(field);
        continue;
      } else checkJsonSchema(field, schema, key);
    } catch (error) {
      if (key === "trafficMix" || key === "routeTable") return error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.message.includes("ids must be unique")) return error.message;
      if (typeof field === "number" && typeof schema.maximum === "number" && field > schema.maximum)
        return `${key} ${number(field)} is over the ${number(schema.maximum)} limit`;
      if (typeof field === "number" && typeof schema.minimum === "number" && field < schema.minimum)
        return `${key} ${number(field)} is under the minimum of ${number(schema.minimum)}`;
      if (typeof field === "number" && !Number.isFinite(field)) return `${key} must be a finite number`;
      if (Array.isArray(schema.enum)) return `${key} must be one of ${schema.enum.join(", ")}`;
      return `${key} must be ${schema.type === "number" ? "a number" : schema.type === "string" ? "text" : "a valid value"}`;
    }
  }
  try {
    checkAutoscaling((value as Record<string, unknown>).resources, (value as Record<string, unknown>).autoscaling);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid autoscaling";
  }
  return undefined;
}
