import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import type { AutoscalingConfig, ComputeResources } from "./autoscaling";

const quantity = { type: "number", minimum: 0, maximum: 1e9 };
const positive = { type: "number", minimum: 0.000001, maximum: 1e9 };
const time = { type: "integer", minimum: 0, maximum: 600_000 };
const interval = { ...time, minimum: 1000 };
const count = { type: "integer", minimum: 1, maximum: 10_000 };
const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
export const resourcesSchema = object(
  {
    preset: { type: "string", maxLength: 100 },
    presetRevision: { enum: ["1"] },
    container: { type: "string", minLength: 1, maxLength: 100 },
    cpuMsPerMessage: quantity,
    baselineMemoryMiB: quantity,
    memoryMiBPerMessage: quantity,
    cpuRequestMilli: positive,
    cpuLimitMilli: positive,
    availableCpuMilli: positive,
    memoryRequestMiB: positive,
    memoryLimitMiB: positive,
    startup: object({ delayMs: time, jitterFraction: { type: "number", minimum: 0, maximum: 1 } }),
    terminationGraceMs: time,
  },
  [
    "preset",
    "presetRevision",
    "cpuMsPerMessage",
    "baselineMemoryMiB",
    "memoryMiBPerMessage",
    "startup",
    "terminationGraceMs",
  ],
);
const direction = object({
  stabilizationMs: time,
  selectPolicy: { enum: ["Max", "Min", "Disabled"] },
  policies: {
    type: "array",
    minItems: 1,
    maxItems: 8,
    items: object({
      type: { enum: ["Pods", "Percent"] },
      value: { type: "integer", minimum: 1, maximum: 10_000 },
      periodMs: interval,
    }),
  },
});
export const autoscalingSchema: JsonSchema = {
  anyOf: [
    object({ mode: { enum: ["off"] } }),
    object({
      mode: { enum: ["unsupported"] },
      provider: { type: "string", maxLength: 100 },
      reason: { type: "string", maxLength: 1000 },
    }),
    object({
      mode: { enum: ["on"] },
      modelRevision: { enum: ["a1"] },
      preset: { type: "string", maxLength: 100 },
      presetRevision: { enum: ["1"] },
      controller: object({
        kind: { enum: ["hpa"] },
        minReplicas: count,
        maxReplicas: count,
        initialReplicas: count,
        settings: object({
          syncMs: interval,
          tolerance: { type: "number", minimum: 0, maximum: 1 },
          initialReadinessDelayMs: time,
          cpuInitializationPeriodMs: time,
          metrics: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: object({
              source: object(
                {
                  kind: { enum: ["resource"] },
                  resource: { enum: ["cpu", "memory"] },
                  container: { type: "string", minLength: 1, maxLength: 100 },
                },
                ["kind", "resource"],
              ),
              target: {
                anyOf: [
                  object({ kind: { enum: ["utilization"] }, percentOfRequest: positive }),
                  object({ kind: { enum: ["averageValue"] }, value: positive }),
                ],
              },
              windowMs: interval,
              metricDelayMs: time,
            }),
          },
          up: direction,
          down: direction,
        }),
      }),
    }),
  ],
};
export function checkAutoscaling(resources?: unknown, autoscaling?: unknown): void {
  if (resources !== undefined) checkJsonSchema(resources, resourcesSchema, "resources");
  if (autoscaling === undefined) return;
  checkJsonSchema(autoscaling, autoscalingSchema, "autoscaling");
  const a = autoscaling as AutoscalingConfig;
  if (a.mode !== "on") return;
  const c = a.controller;
  if (c.settings.metrics.some((m) => m.windowMs + m.metricDelayMs > 600_000))
    throw new Error("autoscaling: metric window plus delay must fit the 600000 ms history budget");
  if (c.minReplicas > c.maxReplicas || c.initialReplicas < c.minReplicas || c.initialReplicas > c.maxReplicas)
    throw new Error("autoscaling: initial and minimum replicas must fit the maximum");
}
/** Semantic diagnostics are shared by checks, resolver and agent descriptions. */
export function autoscalingProblem(resources: unknown, autoscaling: unknown): string | undefined {
  try {
    checkAutoscaling(resources, autoscaling);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid autoscaling";
  }
  const a = autoscaling as AutoscalingConfig | undefined;
  if (a?.mode === "unsupported") return a.reason;
  if (a?.mode !== "on") return undefined;
  if (!resources) return "HPA needs an explicit workload resource assumption.";
  const r = resources as ComputeResources;
  for (const m of a.controller.settings.metrics) {
    if (m.source.container && m.source.container !== r.container)
      return "ContainerResource must name the modelled single container; multi-container accounting is unsupported.";
    if (m.target.kind === "utilization" && !(m.source.resource === "cpu" ? r.cpuRequestMilli : r.memoryRequestMiB))
      return `HPA ${m.source.resource} utilisation needs a resource request; a limit is not a request.`;
  }
  return undefined;
}
