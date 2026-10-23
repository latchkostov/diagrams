import { baseStencilId } from "../stencils/vendorParents";

/** A1 is opt-in. CPU work is CPU-ms per real attempt, never elapsed latency. */
export function resourceWorkload(stencil: string | undefined, family: string | undefined, revision = "a1"): boolean {
  // A Deployment remains infrastructure in older profile evidence. Explicit resource execution is compute.
  return (
    (stencil !== undefined && baseStencilId(stencil) === "k8s.deployment" && revision === "a2") ||
    ["service", "workflow", "stream-processor"].includes(family ?? "")
  );
}
export interface ComputeResources {
  preset: string;
  presetRevision: "1";
  /** Resource execution opt-in survives disabling a controller. */
  modelRevision?: "a2";
  /** Optional identity of the one modelled container, for ContainerResource metrics. */
  container?: string;
  cpuMsPerMessage: number;
  baselineMemoryMiB: number;
  memoryMiBPerMessage: number;
  cpuRequestMilli?: number;
  cpuLimitMilli?: number;
  availableCpuMilli?: number;
  memoryRequestMiB?: number;
  memoryLimitMiB?: number;
  startup: { delayMs: number; jitterFraction: number };
  terminationGraceMs: number;
  /** Imported request defaulting from a limit; all other supplied denominators came from requests. */
  requestDefaults?: ("cpu" | "memory")[];
}
/** Imported sizes (requests/limits, a task or instance size) without measured per-message costs. */
export const UNMEASURED_PRESETS = ["kubernetes-unmeasured", "cloud-unmeasured"];
export function unmeasured(r: Pick<ComputeResources, "preset"> | undefined): boolean {
  return !!r && UNMEASURED_PRESETS.includes(r.preset);
}
export interface DirectionBehaviour {
  stabilizationMs: number;
  selectPolicy: "Max" | "Min" | "Disabled";
  policies: { type: "Pods" | "Percent"; value: number; periodMs: number }[];
}
export interface ScalingMetric {
  source:
    { kind: "resource"; resource: "cpu" | "memory"; container?: string } | { kind: "pods"; metric: "busyThreads" };
  /** CPU averageValue is millicores; memory is MiB; busyThreads is threads per pod.
   * For busyThreads, utilization is a percent of Concurrency. */
  target: { kind: "utilization"; percentOfRequest: number } | { kind: "averageValue"; value: number };
  windowMs: number;
  metricDelayMs: number;
}
export interface HpaSettings {
  syncMs: number;
  tolerance: number;
  initialReadinessDelayMs: number;
  cpuInitializationPeriodMs: number;
  metrics: ScalingMetric[];
  up: DirectionBehaviour;
  down: DirectionBehaviour;
}
export interface HpaController {
  kind: "hpa";
  minReplicas: number;
  maxReplicas: number;
  initialReplicas: number;
  settings: HpaSettings;
}
export interface BrokerBinding {
  node: string;
  /** Named consumer group/subscription. Queues use their single `queue` group. */
  group?: string;
}
interface TriggerBase {
  source: BrokerBinding;
  target: number;
  activation: number;
  useCachedMetrics: boolean;
}
export type KedaTrigger = TriggerBase &
  (
    | { type: "kafka"; allowIdleConsumers: boolean }
    | { type: "azure-servicebus" }
    | { type: "aws-sqs-queue"; scaleOnInFlight: boolean; scaleOnDelayed: false }
    | { type: "rabbitmq"; protocol: "http" | "amqp"; excludeUnacknowledged: boolean }
  );
export interface KedaController extends Omit<HpaController, "kind"> {
  kind: "keda";
  pollingMs: number;
  cooldownMs: number;
  initialCooldownMs: number;
  idleReplicas?: 0;
  triggers: KedaTrigger[];
  fallback?: {
    failureThreshold: number;
    replicas: number;
    behavior: "static" | "currentReplicas" | "currentReplicasIfHigher" | "currentReplicasIfLower";
  };
}
export type HpaConfig = {
  mode: "on";
  modelRevision: "a1";
  preset: string;
  presetRevision: "1";
  controller: HpaController;
};
export type KedaConfig = {
  mode: "on";
  modelRevision: "a2";
  preset: string;
  presetRevision: "1";
  controller: KedaController;
};
/** Shared replica range of every executable controller. */
export interface ReplicaRangeFields {
  minReplicas: number;
  maxReplicas: number;
  initialReplicas: number;
}
/**
 * AWS ECS Service Auto Scaling (Application Auto Scaling). CPU/memory are percent of the task definition's CPU and
 * memory (`resources.cpuLimitMilli` / `memoryLimitMiB`), never a Kubernetes request. ALB metrics count requests the
 * bound load balancer node routed to this service, per minute: per running task for target tracking, in total for
 * step alarms. A per-task metric has no data with no running task, so target tracking cannot wake from zero.
 */
export type EcsMetric = "cpu" | "memory" | "albRequestCountPerTarget" | "albRequestCount";
export interface EcsTargetTracking {
  metric: Exclude<EcsMetric, "albRequestCount">;
  target: number;
  source?: { node: string };
  scaleOutCooldownMs: number;
  scaleInCooldownMs: number;
  disableScaleIn: boolean;
}
export interface EcsStepAdjustment {
  /** Relative to the alarm threshold; absent is unbounded. */
  lower?: number;
  upper?: number;
  adjustment: number;
}
export type EcsOperator =
  "GreaterThanOrEqualToThreshold" | "GreaterThanThreshold" | "LessThanThreshold" | "LessThanOrEqualToThreshold";
export interface EcsStepScaling {
  metric: EcsMetric;
  source?: { node: string };
  operator: EcsOperator;
  threshold: number;
  /** Consecutive breaching metric periods before the alarm invokes the policy. */
  evaluationPeriods: number;
  adjustmentType: "ChangeInCapacity" | "PercentChangeInCapacity" | "ExactCapacity";
  steps: EcsStepAdjustment[];
  minAdjustmentMagnitude?: number;
  cooldownMs: number;
}
export interface EcsController extends ReplicaRangeFields {
  kind: "ecs";
  /** CloudWatch metric period: 60 s standard, 20 s high resolution. Each period ends one evaluation. */
  metricPeriodMs: number;
  /**
   * Assumption, not a published default: the managed target-tracking alarms need `outPeriods` periods above the
   * target to scale out, and `inPeriods` periods below `target × (1 − inMargin)` to scale in.
   */
  alarm: { outPeriods: number; inPeriods: number; inMargin: number };
  targetTracking: EcsTargetTracking[];
  stepScaling: EcsStepScaling[];
}
/**
 * Azure Container Apps: KEDA-based rules on the shared KEDA/HPA pipeline. HTTP counts the requests that arrived in
 * the last 15 s divided by 15, and an HTTP request wakes a sleeping app on demand. Custom event rules are A2 KEDA
 * triggers with their own poll. `settings` pins ACA's documented scale behaviour.
 */
export interface AcaController extends ReplicaRangeFields {
  kind: "aca";
  pollingMs: number;
  cooldownMs: number;
  http?: { concurrentRequests: number };
  triggers: KedaTrigger[];
  settings: HpaSettings;
}
/** Azure Monitor autoscale applied to one App Service plan. Not an HPA ratio controller. */
export type MonitorOperator = "GreaterThan" | "GreaterThanOrEqual" | "LessThan" | "LessThanOrEqual";
export interface MonitorRule {
  /** CpuPercentage / MemoryPercentage of the instance, or HttpQueueLength per instance. */
  metric: "cpu" | "memory" | "httpQueue";
  operator: MonitorOperator;
  threshold: number;
  /** Look-back window (`timeWindow`), averaged. */
  windowMs: number;
  direction: "increase" | "decrease";
  changeType: "ChangeCount" | "PercentChangeCount" | "ExactCount";
  value: number;
  cooldownMs: number;
}
export interface AppServiceController extends ReplicaRangeFields {
  kind: "appService";
  /** Documented as every 30 to 60 s depending on resource type: the value is an assumption. */
  evaluationMs: number;
  rules: MonitorRule[];
}
/**
 * Google Cloud Run, an approximate single-revision adapter. Concurrency is the node's own Concurrency (the
 * container's maximum concurrent requests); CPU is percent of the instance's CPU limit. Both targets default to
 * 60% with a documented 10% relative tolerance; concurrency uses the higher of a short and a long average. Waiting
 * requests start instances on demand. Cadence, idle retention and cold start are assumptions (UNVERIFIED).
 */
export interface CloudRunController extends ReplicaRangeFields {
  kind: "cloudRun";
  targetConcurrencyPct: number;
  targetCpuPct: number;
  evaluationMs: number;
  cpuWindowMs: number;
  concurrencyWindowsMs: [number, number];
  scaleInDelayMs: number;
}
export type CloudController = EcsController | AcaController | AppServiceController | CloudRunController;
export type CloudConfig = {
  mode: "on";
  modelRevision: "a3";
  preset: string;
  presetRevision: "1";
  controller: CloudController;
};
export type ExecutableController = HpaController | KedaController | CloudController;
export type AutoscalingConfig =
  | { mode: "off" }
  | HpaConfig
  | (Omit<HpaConfig, "modelRevision"> & { modelRevision: "a2" })
  | KedaConfig
  | CloudConfig
  | {
      mode: "unsupported";
      provider: string;
      reason: string;
      controllers?: ScalingSummary[];
      controllersOmitted?: number;
    };
export interface ScalingSummary {
  kind: "HPA" | "ScaledObject" | "ScaledJob";
  minReplicas?: number;
  maxReplicas?: number;
}

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
/** The controller's own evaluation cadence: HPA sync, ECS metric period, Monitor evaluation, Cloud Run evaluation. */
export function controllerSyncMs(c: ExecutableController): number {
  return c.kind === "ecs"
    ? c.metricPeriodMs
    : c.kind === "appService" || c.kind === "cloudRun"
      ? c.evaluationMs
      : c.settings.syncMs;
}
/** Controllers whose minimum (and idle state) may be zero. HPA and App Service plans keep at least one. */
export function zeroCapable(controller: { kind: ExecutableController["kind"] | "aca" }): boolean {
  return controller.kind !== "hpa" && controller.kind !== "appService";
}
export function replicaRange(controller: ReplicaRangeFields & { kind: ExecutableController["kind"] }, multiplier = 1) {
  const count = (n: number) =>
    Math.max(zeroCapable(controller) && n === 0 ? 0 : 1, Math.min(10_000, Math.round(n * multiplier)));
  return {
    min: count(controller.minReplicas),
    max: count(controller.maxReplicas),
    initial: count(controller.initialReplicas),
  };
}
export function resourceCapacity(resources: ComputeResources | undefined, slots: number, latencyMs: number): number {
  const slotRate = slots === 0 ? 0 : latencyMs ? (slots * 1000) / latencyMs : Infinity;
  const milli = resources?.cpuLimitMilli ?? resources?.availableCpuMilli;
  return resources && resources.cpuMsPerMessage && milli !== undefined
    ? Math.min(slotRate, milli / resources.cpuMsPerMessage)
    : slotRate;
}
