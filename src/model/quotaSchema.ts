import { QUOTA_UNITS } from "./admission";
import type { JsonSchema } from "./jsonSchema";
export const id = { type: "string", minLength: 1, maxLength: 200 };
export const quantity = { type: "number", minimum: 0, maximum: 1e12 };
export const positive = { type: "number", minimum: 0.000001, maximum: 1e12 };
export const time = { type: "number", minimum: 0, maximum: 600000 };
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
