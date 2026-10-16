import { checkJsonSchema, type JsonSchema } from "./jsonSchema";
import type { AutoscalingConfig, ComputeResources, EcsStepScaling, ExecutableController } from "./autoscaling";

const quantity = { type: "number", minimum: 0, maximum: 1e9 };
const positive = { type: "number", minimum: 0.000001, maximum: 1e9 };
const signed = { type: "number", minimum: -1e9, maximum: 1e9 };
const time = { type: "integer", minimum: 0, maximum: 600_000 };
const interval = { ...time, minimum: 1000 };
const count = { type: "integer", minimum: 1, maximum: 10_000 };
const object = (
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema & { properties: Record<string, JsonSchema> } => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
export const resourcesSchema = object(
  {
    preset: { type: "string", maxLength: 100 },
    presetRevision: { enum: ["1"] },
    modelRevision: { enum: ["a2"] },
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
    requestDefaults: { type: "array", maxItems: 2, items: { enum: ["cpu", "memory"] } },
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
export const hpaSettingsSchema = object({
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
});
/** KEDA's generated HPA may have no resource metrics: its triggers supply the recommendation. */
const triggerSettings = {
  ...hpaSettingsSchema,
  properties: {
    ...hpaSettingsSchema.properties,
    metrics: { ...hpaSettingsSchema.properties.metrics, minItems: 0 },
  },
};
const binding = object(
  { node: { type: "string", minLength: 1, maxLength: 1000 }, group: { type: "string", minLength: 1, maxLength: 1000 } },
  ["node"],
);
const trigger = (properties: Record<string, JsonSchema>) =>
  object({
    source: binding,
    target: positive,
    activation: quantity,
    useCachedMetrics: { type: "boolean" },
    ...properties,
  });
const kedaTrigger: JsonSchema = {
  anyOf: [
    trigger({ type: { enum: ["kafka"] }, allowIdleConsumers: { type: "boolean" } }),
    trigger({ type: { enum: ["azure-servicebus"] } }),
    trigger({
      type: { enum: ["aws-sqs-queue"] },
      scaleOnInFlight: { type: "boolean" },
      scaleOnDelayed: { enum: [false] },
    }),
    trigger({
      type: { enum: ["rabbitmq"] },
      protocol: { enum: ["http", "amqp"] },
      excludeUnacknowledged: { type: "boolean" },
    }),
  ],
};
const kedaController = object(
  {
    kind: { enum: ["keda"] },
    minReplicas: { ...count, minimum: 0 },
    maxReplicas: count,
    initialReplicas: { ...count, minimum: 0 },
    pollingMs: interval,
    cooldownMs: time,
    initialCooldownMs: time,
    idleReplicas: { enum: [0] },
    settings: triggerSettings,
    triggers: { type: "array", minItems: 1, maxItems: 16, items: kedaTrigger },
    fallback: object({
      failureThreshold: { ...count, minimum: 0, maximum: 600 },
      replicas: count,
      behavior: { enum: ["static", "currentReplicas", "currentReplicasIfHigher", "currentReplicasIfLower"] },
    }),
  },
  [
    "kind",
    "minReplicas",
    "maxReplicas",
    "initialReplicas",
    "pollingMs",
    "cooldownMs",
    "initialCooldownMs",
    "settings",
    "triggers",
  ],
);
// ---------------------------------------------------------------- A3 cloud adapters
const zeroRange = {
  minReplicas: { ...count, minimum: 0 },
  maxReplicas: count,
  initialReplicas: { ...count, minimum: 0 },
};
const loadBalancer = object({ node: { type: "string", minLength: 1, maxLength: 1000 } });
const ecsTargetTracking = object(
  {
    metric: { enum: ["cpu", "memory", "albRequestCountPerTarget"] },
    target: positive,
    source: loadBalancer,
    scaleOutCooldownMs: time,
    scaleInCooldownMs: time,
    disableScaleIn: { type: "boolean" },
  },
  ["metric", "target", "scaleOutCooldownMs", "scaleInCooldownMs", "disableScaleIn"],
);
const ecsStepScaling = object(
  {
    metric: { enum: ["cpu", "memory", "albRequestCountPerTarget", "albRequestCount"] },
    source: loadBalancer,
    operator: {
      enum: [
        "GreaterThanOrEqualToThreshold",
        "GreaterThanThreshold",
        "LessThanThreshold",
        "LessThanOrEqualToThreshold",
      ],
    },
    threshold: quantity,
    evaluationPeriods: { type: "integer", minimum: 1, maximum: 60 },
    adjustmentType: { enum: ["ChangeInCapacity", "PercentChangeInCapacity", "ExactCapacity"] },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: object(
        { lower: signed, upper: signed, adjustment: { type: "integer", minimum: -10_000, maximum: 10_000 } },
        ["adjustment"],
      ),
    },
    minAdjustmentMagnitude: count,
    cooldownMs: time,
  },
  ["metric", "operator", "threshold", "evaluationPeriods", "adjustmentType", "steps", "cooldownMs"],
);
const ecsController = object({
  kind: { enum: ["ecs"] },
  ...zeroRange,
  metricPeriodMs: interval,
  alarm: object({
    outPeriods: { type: "integer", minimum: 1, maximum: 60 },
    inPeriods: { type: "integer", minimum: 1, maximum: 60 },
    inMargin: { type: "number", minimum: 0, maximum: 0.9 },
  }),
  targetTracking: { type: "array", minItems: 0, maxItems: 8, items: ecsTargetTracking },
  stepScaling: { type: "array", minItems: 0, maxItems: 8, items: ecsStepScaling },
});
const acaController = object(
  {
    kind: { enum: ["aca"] },
    ...zeroRange,
    pollingMs: interval,
    cooldownMs: time,
    http: object({ concurrentRequests: positive }),
    triggers: { type: "array", minItems: 0, maxItems: 16, items: kedaTrigger },
    settings: triggerSettings,
  },
  ["kind", "minReplicas", "maxReplicas", "initialReplicas", "pollingMs", "cooldownMs", "triggers", "settings"],
);
const monitorRule = object({
  metric: { enum: ["cpu", "memory", "httpQueue"] },
  operator: { enum: ["GreaterThan", "GreaterThanOrEqual", "LessThan", "LessThanOrEqual"] },
  threshold: quantity,
  windowMs: interval,
  direction: { enum: ["increase", "decrease"] },
  changeType: { enum: ["ChangeCount", "PercentChangeCount", "ExactCount"] },
  value: { type: "integer", minimum: 0, maximum: 10_000 },
  cooldownMs: time,
});
const appServiceController = object({
  kind: { enum: ["appService"] },
  minReplicas: count,
  maxReplicas: count,
  initialReplicas: count,
  evaluationMs: interval,
  rules: { type: "array", minItems: 1, maxItems: 10, items: monitorRule },
});
const percent = { type: "number", minimum: 1, maximum: 100 };
const cloudRunController = object({
  kind: { enum: ["cloudRun"] },
  ...zeroRange,
  targetConcurrencyPct: percent,
  targetCpuPct: percent,
  evaluationMs: interval,
  cpuWindowMs: interval,
  concurrencyWindowsMs: { type: "array", minItems: 2, maxItems: 2, items: interval },
  scaleInDelayMs: time,
});
export const autoscalingSchema: JsonSchema = {
  anyOf: [
    object({
      mode: { enum: ["on"] },
      modelRevision: { enum: ["a2"] },
      preset: { type: "string", maxLength: 100 },
      presetRevision: { enum: ["1"] },
      controller: kedaController,
    }),
    object({ mode: { enum: ["off"] } }),
    object(
      {
        mode: { enum: ["unsupported"] },
        provider: { type: "string", maxLength: 100 },
        reason: { type: "string", maxLength: 1000 },
        controllers: {
          type: "array",
          maxItems: 16,
          items: object(
            {
              kind: { enum: ["HPA", "ScaledObject", "ScaledJob"] },
              minReplicas: { ...count, minimum: 0, maximum: 100_000 },
              maxReplicas: { ...count, minimum: 0, maximum: 100_000 },
            },
            ["kind"],
          ),
        },
        controllersOmitted: { type: "integer", minimum: 0, maximum: 10_000 },
      },
      ["mode", "provider", "reason"],
    ),
    object({
      mode: { enum: ["on"] },
      modelRevision: { enum: ["a1", "a2"] },
      preset: { type: "string", maxLength: 100 },
      presetRevision: { enum: ["1"] },
      controller: object({
        kind: { enum: ["hpa"] },
        minReplicas: count,
        maxReplicas: count,
        initialReplicas: count,
        settings: hpaSettingsSchema,
      }),
    }),
    object({
      mode: { enum: ["on"] },
      modelRevision: { enum: ["a3"] },
      preset: { type: "string", maxLength: 100 },
      presetRevision: { enum: ["1"] },
      controller: { anyOf: [ecsController, acaController, appServiceController, cloudRunController] },
    }),
  ],
};
/** CloudWatch step bounds: no overlap, no gap, one open end per side, never both open (AWS step scaling docs). */
function checkSteps(p: EcsStepScaling): void {
  const steps = [...p.steps].sort((a, b) => (a.lower ?? -Infinity) - (b.lower ?? -Infinity));
  for (const s of steps) {
    if (s.lower === undefined && s.upper === undefined)
      throw new Error("autoscaling: a step adjustment needs a lower or an upper bound");
    if (s.lower !== undefined && s.upper !== undefined && s.lower >= s.upper)
      throw new Error("autoscaling: step lower bound must be below its upper bound");
  }
  for (let i = 1; i < steps.length; i++)
    if (steps[i - 1].upper === undefined || steps[i - 1].upper !== steps[i].lower)
      throw new Error("autoscaling: step adjustments overlap or leave a gap");
  const low = steps[0].lower,
    high = steps.at(-1)!.upper;
  if (low !== undefined && low < 0) throw new Error("autoscaling: a negative lower bound needs an open lower step");
  if (high !== undefined && high > 0) throw new Error("autoscaling: a positive upper bound needs an open upper step");
  const above = p.operator.startsWith("Greater");
  // Above the threshold the metric distance is ≥ 0; below it ≤ 0. Steps must cover the breached side.
  if (above ? high !== undefined || (low ?? 0) > 0 : low !== undefined || (high ?? 0) < 0)
    throw new Error("autoscaling: step adjustments must cover the alarm's breached side");
  if (p.adjustmentType === "ExactCapacity" && p.steps.some((s) => s.adjustment < 0))
    throw new Error("autoscaling: ExactCapacity adjustments must be zero or more");
  if (p.minAdjustmentMagnitude !== undefined && p.adjustmentType !== "PercentChangeInCapacity")
    throw new Error("autoscaling: minAdjustmentMagnitude applies only to PercentChangeInCapacity");
}
function checkCloud(c: ExecutableController): void {
  if (c.kind === "ecs") {
    if (!c.targetTracking.length && !c.stepScaling.length)
      throw new Error("autoscaling: ECS needs a target tracking or step scaling policy");
    if (new Set(c.targetTracking.map((p) => p.metric)).size !== c.targetTracking.length)
      throw new Error("autoscaling: ECS target tracking policies each need a different metric");
    for (const p of [...c.targetTracking, ...c.stepScaling]) {
      const alb = p.metric.startsWith("alb");
      if (alb !== (p.source !== undefined))
        throw new Error("autoscaling: ALB request metrics, and only they, bind a load balancer");
    }
    for (const p of c.stepScaling) checkSteps(p);
    const periods = Math.max(c.alarm.outPeriods, c.alarm.inPeriods, ...c.stepScaling.map((p) => p.evaluationPeriods));
    if (periods * c.metricPeriodMs > 600_000)
      throw new Error("autoscaling: alarm periods must fit the 600000 ms history budget");
  }
  if (c.kind === "aca") {
    if (!c.http && !c.triggers.length) throw new Error("autoscaling: Container Apps needs an HTTP or event rule");
    if (c.triggers.length + c.settings.metrics.length + (c.http ? 1 : 0) > 16)
      throw new Error("autoscaling: at most 16 metrics and triggers");
  }
  if (c.kind === "appService") {
    for (const r of c.rules) {
      if (r.changeType !== "ExactCount" && r.value < 1)
        throw new Error("autoscaling: a Monitor scale action changes at least one instance");
      if (r.changeType === "PercentChangeCount" && r.value > 1000)
        throw new Error("autoscaling: a percent change is at most 1000");
    }
  }
}
export function checkAutoscaling(resources?: unknown, autoscaling?: unknown): void {
  if (resources !== undefined) checkJsonSchema(resources, resourcesSchema, "resources");
  if (autoscaling === undefined) return;
  checkJsonSchema(autoscaling, autoscalingSchema, "autoscaling");
  const a = autoscaling as AutoscalingConfig;
  if (a.mode !== "on") return;
  const c = a.controller;
  checkCloud(c);
  if (c.kind === "keda" || c.kind === "aca") {
    if (c.kind === "keda" && c.triggers.length + c.settings.metrics.length > 16)
      throw new Error("autoscaling: at most 16 metrics and triggers");
    if (c.kind === "keda" && c.idleReplicas !== undefined && c.minReplicas === 0)
      throw new Error("autoscaling: idle replicas must be below the minimum");
    for (const t of c.triggers) {
      if (t.type === "kafka" && !t.source.group)
        throw new Error("autoscaling: Kafka needs a named consumer group and known topic history");
      if (t.type === "rabbitmq" && t.protocol === "amqp" && !t.excludeUnacknowledged)
        throw new Error("autoscaling: RabbitMQ AMQP observes ready messages only");
    }
  }
  if ("settings" in c && c.settings.metrics.some((m) => m.windowMs + m.metricDelayMs > 600_000))
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
  if (!resources) return "Autoscaling needs an explicit workload resource assumption.";
  const r = resources as ComputeResources;
  const c = a.controller;
  const metrics = "settings" in c ? c.settings.metrics : [];
  const unmeasured = r.preset === "kubernetes-unmeasured";
  if (unmeasured && (metrics.length || cloudResourceMetrics(c).length))
    return "Imported requests and limits do not measure CPU or memory per message. Choose a workload lesson before resource predictions.";
  for (const m of metrics) {
    if (m.source.container && m.source.container !== r.container)
      return "ContainerResource must name the modelled single container; multi-container accounting is unsupported.";
    if (m.target.kind === "utilization" && !(m.source.resource === "cpu" ? r.cpuRequestMilli : r.memoryRequestMiB))
      return `HPA ${m.source.resource} utilisation needs a resource request; a limit is not a request.`;
  }
  for (const resource of cloudResourceMetrics(c)) {
    const cpu = resource === "cpu";
    const denominator =
      c.kind === "appService"
        ? cpu
          ? (r.cpuLimitMilli ?? r.availableCpuMilli)
          : r.memoryLimitMiB
        : cpu
          ? r.cpuLimitMilli
          : r.memoryLimitMiB;
    if (!denominator)
      return c.kind === "ecs"
        ? `ECS ${resource} utilisation is a percent of the task's ${resource}; set the ${resource} limit as the task size.`
        : c.kind === "cloudRun"
          ? "Cloud Run CPU utilisation is a percent of the instance's CPU limit; set the CPU limit."
          : `App Service ${resource} percentage needs the instance's ${resource} size; set the ${resource} limit.`;
  }
  return undefined;
}
/** CPU/memory inputs of the cloud adapters, whose denominators are task or instance sizes. */
export function cloudResourceMetrics(c: ExecutableController): ("cpu" | "memory")[] {
  const used =
    c.kind === "ecs"
      ? [...c.targetTracking, ...c.stepScaling].map((p) => p.metric)
      : c.kind === "appService"
        ? c.rules.map((r) => r.metric)
        : c.kind === "cloudRun"
          ? ["cpu"]
          : [];
  return [...new Set(used.filter((m): m is "cpu" | "memory" => m === "cpu" || m === "memory"))];
}
