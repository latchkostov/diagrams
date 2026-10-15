/** A1 is opt-in. CPU work is CPU-ms per real attempt, never elapsed latency. */
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
export type AutoscalingConfig =
  | { mode: "off" }
  | { mode: "on"; modelRevision: "a1"; preset: string; presetRevision: "1"; controller: HpaController }
  | { mode: "unsupported"; provider: string; reason: string };

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
export function hpaLesson(): AutoscalingConfig & { mode: "on" } {
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
export function replicaRange(controller: HpaController, multiplier = 1) {
  const count = (n: number) => Math.max(1, Math.min(10_000, Math.round(n * multiplier)));
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
