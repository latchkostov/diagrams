// Authoring presets load with their controls and importers, never with file validation.
import type {
  ComputeResources,
  HpaConfig,
  KedaTrigger,
  BrokerBinding,
  KedaConfig,
  HpaSettings,
  CloudConfig,
} from "./autoscaling";

export const RESOURCE_LESSONS: Readonly<Record<string, ComputeResources>> = {
  "io-service": {
    preset: "io-service",
    presetRevision: "1",
    cpuMsPerMessage: 40,
    baselineMemoryMiB: 128,
    memoryMiBPerMessage: 2,
    cpuRequestMilli: 500,
    cpuLimitMilli: 1000,
    memoryRequestMiB: 256,
    memoryLimitMiB: 512,
    startup: { delayMs: 5000, jitterFraction: 0 },
    terminationGraceMs: 30_000,
  },
};
export function resourceLesson(id = "io-service"): ComputeResources {
  const base = structuredClone(RESOURCE_LESSONS["io-service"]);
  if (id === "cpu-worker") Object.assign(base, { preset: id, cpuMsPerMessage: 200, cpuRequestMilli: 1000 });
  if (id === "workflow")
    Object.assign(base, {
      preset: id,
      cpuMsPerMessage: 10,
      baselineMemoryMiB: 256,
      memoryMiBPerMessage: 4,
      memoryRequestMiB: 512,
      memoryLimitMiB: 1024,
    });
  if (id === "stream-worker")
    Object.assign(base, {
      preset: id,
      cpuMsPerMessage: 50,
      baselineMemoryMiB: 256,
      memoryMiBPerMessage: 8,
      cpuRequestMilli: 1000,
      cpuLimitMilli: 2000,
      memoryRequestMiB: 512,
      memoryLimitMiB: 1024,
    });
  return base;
}
/** Published Kubernetes defaults; the lesson explicitly chooses 70%, min 1/max 10. */
export function hpaLesson(): HpaConfig {
  return {
    mode: "on",
    modelRevision: "a1",
    preset: "hpa-service",
    presetRevision: "1",
    controller: {
      kind: "hpa",
      minReplicas: 1,
      maxReplicas: 10,
      initialReplicas: 1,
      settings: {
        syncMs: 15_000,
        tolerance: 0.1,
        initialReadinessDelayMs: 30_000,
        cpuInitializationPeriodMs: 300_000,
        metrics: [
          {
            source: { kind: "resource", resource: "cpu" },
            target: { kind: "utilization", percentOfRequest: 70 },
            windowMs: 15_000,
            metricDelayMs: 0,
          },
        ],
        up: {
          stabilizationMs: 0,
          selectPolicy: "Max",
          policies: [
            { type: "Pods", value: 4, periodMs: 15_000 },
            { type: "Percent", value: 100, periodMs: 15_000 },
          ],
        },
        down: {
          stabilizationMs: 300_000,
          selectPolicy: "Max",
          policies: [{ type: "Percent", value: 100, periodMs: 15_000 }],
        },
      },
    },
  };
}
export function kedaLesson(type: KedaTrigger["type"] = "kafka", source: BrokerBinding = { node: "" }): KedaConfig {
  const trigger: KedaTrigger = {
    source,
    target: type === "kafka" ? 10 : type === "rabbitmq" ? 20 : 5,
    activation: 0,
    useCachedMetrics: false,
    ...(type === "kafka"
      ? { type, allowIdleConsumers: false }
      : type === "aws-sqs-queue"
        ? { type, scaleOnInFlight: true, scaleOnDelayed: false }
        : type === "rabbitmq"
          ? { type, protocol: "amqp", excludeUnacknowledged: true }
          : { type }),
  };
  return {
    mode: "on",
    modelRevision: "a2",
    preset: `keda-${type}`,
    presetRevision: "1",
    controller: {
      kind: "keda",
      minReplicas: 0,
      initialReplicas: 0,
      maxReplicas: 100,
      pollingMs: 30_000,
      cooldownMs: 300_000,
      initialCooldownMs: 0,
      triggers: [trigger],
      settings: { ...hpaLesson().controller.settings, metrics: [] },
    },
  };
}
/** ACA's documented scale behaviour (learn.microsoft.com/azure/container-apps/scale-app, checked 2026-10-15):
 * scale-up stabilization 0 s and steps 1, 4, 8, 16, 32 (`max(4, 2 × current)`, here +3 or +100% per 15 s, which
 * reproduces 1→4→8→16 exactly), scale-down stabilization 300 s removing 100%, `ceil(metric / target)`. */
function acaSettings(): HpaSettings {
  return {
    ...hpaLesson().controller.settings,
    metrics: [],
    up: {
      stabilizationMs: 0,
      selectPolicy: "Max",
      policies: [
        { type: "Pods", value: 3, periodMs: 15_000 },
        { type: "Percent", value: 100, periodMs: 15_000 },
      ],
    },
    down: {
      stabilizationMs: 300_000,
      selectPolicy: "Max",
      policies: [{ type: "Percent", value: 100, periodMs: 15_000 }],
    },
  };
}
export type CloudPreset = "ecs-cpu" | "ecs-alb" | "ecs-step" | "aca-http" | "aca-event" | "app-service" | "cloud-run";
/** One preset per platform. Documented defaults are cited in docs/SIMULATION.md; everything else is a labelled assumption. */
export function cloudLesson(
  preset: CloudPreset,
  options: { source?: string; trigger?: KedaTrigger["type"]; binding?: BrokerBinding } = {},
): CloudConfig {
  const base = { mode: "on" as const, modelRevision: "a3" as const, preset, presetRevision: "1" as const };
  if (preset === "aca-http" || preset === "aca-event")
    return {
      ...base,
      controller: {
        kind: "aca",
        // Documented: min 0, max 10; polling 30 s and final-zero cooldown 300 s for custom rules.
        minReplicas: 0,
        initialReplicas: 0,
        maxReplicas: 10,
        pollingMs: 30_000,
        cooldownMs: 300_000,
        ...(preset === "aca-http" ? { http: { concurrentRequests: 10 } } : {}),
        triggers:
          preset === "aca-event"
            ? kedaLesson(options.trigger ?? "azure-servicebus", options.binding ?? { node: "" }).controller.triggers
            : [],
        settings: acaSettings(),
      },
    };
  if (preset === "app-service")
    return {
      ...base,
      controller: {
        kind: "appService",
        minReplicas: 1,
        initialReplicas: 1,
        maxReplicas: 10,
        evaluationMs: 60_000,
        // Assumption (research §2): 70%/30% CPU over five minutes, ±1 instance, 5 min cooldown (documented default).
        rules: [
          {
            metric: "cpu",
            operator: "GreaterThan",
            threshold: 70,
            windowMs: 300_000,
            direction: "increase",
            changeType: "ChangeCount",
            value: 1,
            cooldownMs: 300_000,
          },
          {
            metric: "cpu",
            operator: "LessThan",
            threshold: 30,
            windowMs: 300_000,
            direction: "decrease",
            changeType: "ChangeCount",
            value: 1,
            cooldownMs: 300_000,
          },
        ],
      },
    };
  if (preset === "cloud-run")
    return {
      ...base,
      controller: {
        kind: "cloudRun",
        // Documented: min 0, revision max 100, 60% targets, 1-min CPU average, max of 1- and 10-min concurrency.
        minReplicas: 0,
        initialReplicas: 0,
        maxReplicas: 100,
        targetConcurrencyPct: 60,
        targetCpuPct: 60,
        // UNVERIFIED cadence and an assumed 60 s idle retention (Cloud Run may keep idle instances up to 15 min).
        evaluationMs: 10_000,
        cpuWindowMs: 60_000,
        concurrencyWindowsMs: [60_000, 600_000],
        scaleInDelayMs: 60_000,
      },
    };
  const cooldowns = { scaleOutCooldownMs: 300_000, scaleInCooldownMs: 300_000, disableScaleIn: false };
  return {
    ...base,
    controller: {
      kind: "ecs",
      minReplicas: 1,
      initialReplicas: 1,
      maxReplicas: 10,
      metricPeriodMs: 60_000,
      alarm: { outPeriods: 3, inPeriods: 15, inMargin: 0.1 },
      targetTracking:
        preset === "ecs-step"
          ? []
          : preset === "ecs-alb"
            ? [
                {
                  metric: "albRequestCountPerTarget",
                  target: 1000,
                  source: { node: options.source ?? "" },
                  ...cooldowns,
                },
              ]
            : [{ metric: "cpu", target: 70, ...cooldowns }],
      stepScaling:
        preset === "ecs-step"
          ? [
              {
                metric: "cpu",
                operator: "GreaterThanOrEqualToThreshold",
                threshold: 70,
                evaluationPeriods: 3,
                adjustmentType: "ChangeInCapacity",
                steps: [
                  { lower: 0, upper: 15, adjustment: 1 },
                  { lower: 15, adjustment: 3 },
                ],
                cooldownMs: 300_000,
              },
              {
                metric: "cpu",
                operator: "LessThanOrEqualToThreshold",
                threshold: 30,
                evaluationPeriods: 15,
                adjustmentType: "ChangeInCapacity",
                steps: [{ upper: 0, adjustment: -1 }],
                cooldownMs: 300_000,
              },
            ]
          : [],
    },
  };
}
