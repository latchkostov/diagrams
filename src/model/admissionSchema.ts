import { QUOTA_UNITS } from "./admission";
import type { JsonSchema } from "./jsonSchema";
const id = { type: "string", minLength: 1, maxLength: 200 };
const quantity = { type: "number", minimum: 0, maximum: 1e12 };
const positive = { type: "number", minimum: 0.000001, maximum: 1e12 };
const time = { type: "number", minimum: 0, maximum: 600000 };
export const quotaSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "unit", "amount", "windowMs", "algorithm"],
  properties: {
    id,
    unit: { enum: QUOTA_UNITS },
    amount: positive,
    windowMs: { type: "number", minimum: 1, maximum: 86400000 },
    algorithm: { type: "string", enum: ["token-bucket"] },
    burst: quantity,
    sharedGroup: id,
  },
};
export const allocationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "maxInFlight"],
  properties: { id, maxInFlight: quantity },
};
export const apiSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    quotas: { type: "array", maxItems: 32, items: quotaSchema },
    maxInFlight: quantity,
    sharedConcurrency: id,
    latencyMs: time,
    errorRate: { type: "number", minimum: 0, maximum: 1 },
    costPerRequest: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        QUOTA_UNITS.map((unit) => [unit, unit === "requests" ? { type: "number", minimum: 1, maximum: 1 } : quantity]),
      ),
    },
  },
};
export const endpointsSchema: JsonSchema = {
  type: "array",
  maxItems: 500,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "method", "path"],
    properties: {
      id,
      method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] },
      path: { type: "string", minLength: 1, maxLength: 2000, pattern: "^/" },
      behaviour: apiSchema,
    },
  },
};
const retry: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["maxAttempts", "backoffMs", "strategy", "retryOn"],
  properties: {
    maxAttempts: { type: "integer", minimum: 1, maximum: 1000 },
    backoffMs: time,
    strategy: { enum: ["fixed", "exponential"] },
    jitter: { type: "number", minimum: 0, maximum: 1 },
    retryOn: { type: "array", maxItems: 3, uniqueItems: true, items: { enum: ["throttled", "transient", "timeout"] } },
    idempotent: { type: "boolean" },
  },
};
export const callerSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { deadlineMs: time, retry, poolConnections: { type: "integer", minimum: 1, maximum: 10000 } },
};
export const planningSchema: JsonSchema = {
  type: "object",
  required: ["revision"],
  additionalProperties: false,
  properties: {
    revision: { enum: ["p1", "p2", "p3"] },
    sharedQuotas: { type: "array", maxItems: 128, items: quotaSchema },
    sharedAllocations: { type: "array", maxItems: 128, items: allocationSchema },
  },
};
