import { resourceCapacity, replicaRange } from "../model/autoscaling";
import type { ResolvedProps } from "./defaults";

/** Configured arithmetic, not a promise about a burst or the current ready fleet. */
export function resourcePlan(p: ResolvedProps, offered: number, assigned: number, multiplier = 1) {
  const r = p.resources;
  if (!r) return undefined;
  const c = p.autoscaling?.mode === "on" ? p.autoscaling.controller : undefined;
  const range = c ? replicaRange(c, multiplier) : undefined;
  const fixed = Math.max(1, Math.min(10_000, Math.round(p.replicas * multiplier)));
  const perReplica = resourceCapacity(r, p.concurrency, p.latencyMs);
  const metrics = c?.settings.metrics ?? [];
  const targetValue = (m: (typeof metrics)[number]) =>
    m.target.kind === "averageValue"
      ? m.target.value
      : ((m.source.resource === "cpu" ? (r.cpuRequestMilli ?? 0) : (r.memoryRequestMiB ?? 0)) *
          m.target.percentOfRequest) /
        100;
  const cpuMilli = r.cpuLimitMilli ?? r.availableCpuMilli ?? Infinity;
  const residenceSeconds = Math.max(p.latencyMs / 1000, (r.cpuMsPerMessage * p.concurrency) / cpuMilli);
  const needed = metrics.flatMap((m) => {
    const target = targetValue(m);
    if (m.source.resource === "cpu")
      return target && r.cpuMsPerMessage ? [Math.ceil((offered * r.cpuMsPerMessage) / target)] : [];
    return target > r.baselineMemoryMiB
      ? [Math.ceil((offered * residenceSeconds * r.memoryMiBPerMessage) / (target - r.baselineMemoryMiB))]
      : [];
  });
  const targetReplicas = needed.length ? Math.max(range?.min ?? 1, ...needed) : undefined;
  return {
    perReplica,
    initial: range?.initial ?? fixed,
    min: range?.min,
    max: range?.max,
    initialCapacity: assigned * perReplica,
    maxCapacity: range ? range.max * perReplica : fixed * perReplica,
    targetReplicas,
    cpuRequestPct: r.cpuRequestMilli
      ? ((offered * r.cpuMsPerMessage) / Math.max(1, assigned) / r.cpuRequestMilli) * 100
      : undefined,
    memoryPeakMiB: r.baselineMemoryMiB + p.concurrency * r.memoryMiBPerMessage,
    memoryRisk:
      r.memoryLimitMiB !== undefined && r.baselineMemoryMiB + p.concurrency * r.memoryMiBPerMessage > r.memoryLimitMiB,
    baselineAboveTarget: metrics.some(
      (m) =>
        m.source.resource === "memory" &&
        (r.baselineMemoryMiB > targetValue(m) ||
          (r.baselineMemoryMiB === targetValue(m) && r.memoryMiBPerMessage > 0 && offered > 0)),
    ),
    partitionLimited: assigned < (range?.initial ?? fixed),
    startupMs: r.startup.delayMs,
    cpuUnbounded: r.cpuLimitMilli === undefined && r.availableCpuMilli === undefined,
  };
}
export type ResourcePlan = NonNullable<ReturnType<typeof resourcePlan>>;
