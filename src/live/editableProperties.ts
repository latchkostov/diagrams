import { nodeProperties } from "../model/simProps";

/** Timeline property choices and their file-format numeric constraints, shared with field diagnostics. */
export const editableProperties = (
  [
    "latencyMs",
    "concurrency",
    "failureRate",
    "partitions",
    "ratePerSec",
    "maxDeliveryCount",
  ] as const satisfies readonly (keyof typeof nodeProperties)[]
).map((key) => ({ key, ...nodeProperties[key] }));
