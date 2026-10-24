// Playback/planning arithmetic loads with those features, not with native validation.
import type { ExecutableController, ReplicaRangeFields, ComputeResources } from "./autoscaling";

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
