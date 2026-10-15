/** A1 is opt-in. CPU work is CPU-ms per real attempt, never elapsed latency. */
export function resourceWorkload(stencil: string | undefined, family: string | undefined, revision = "a1"): boolean {
  // A Deployment remains infrastructure in older profile evidence. Explicit resource execution is compute.
  return (
    (stencil === "k8s.deployment" && revision === "a2") ||
    ["service", "workflow", "stream-processor"].includes(family ?? "")
  );
}
export interface ComputeResources {
  preset: string;
  presetRevision: "1";
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
export interface DirectionBehaviour {
  stabilizationMs: number;
  selectPolicy: "Max" | "Min" | "Disabled";
  policies: { type: "Pods" | "Percent"; value: number; periodMs: number }[];
}
export interface ScalingMetric {
  source: { kind: "resource"; resource: "cpu" | "memory"; container?: string };
  /** CPU averageValue is millicores; memory averageValue is MiB. */
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
export type AutoscalingConfig =
  | { mode: "off" }
  | HpaConfig
  | (Omit<HpaConfig, "modelRevision"> & { modelRevision: "a2" })
  | KedaConfig
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
export function replicaRange(controller: HpaController | KedaController, multiplier = 1) {
  const count = (n: number) =>
    Math.max(controller.kind === "keda" ? 0 : 1, Math.min(10_000, Math.round(n * multiplier)));
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
