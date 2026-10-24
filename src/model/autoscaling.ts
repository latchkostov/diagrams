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
