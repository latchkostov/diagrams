import { unmeasured, type ComputeResources, type ExecutableController } from "../model/autoscaling";
import { resourceCapacity, replicaRange } from "../model/resourceRuntime";
import type { ResolvedProps } from "./defaults";
import { resolvedTiming, type ResolvedTiming } from "./timing";

/** Steady-state replicas each A3 policy's own target asks for at `offered` real messages/s. */
function cloudNeeded(
  c: ExecutableController,
  r: ComputeResources,
  offered: number,
  concurrency: number,
  residenceSeconds: number,
): number[] {
  const cpuAt = (size: number | undefined, pct: number) =>
    size && r.cpuMsPerMessage && pct > 0 ? [Math.ceil((offered * r.cpuMsPerMessage) / ((size * pct) / 100))] : [];
  const memoryAt = (size: number | undefined, pct: number) => {
    const target = ((size ?? 0) * pct) / 100;
    return target > r.baselineMemoryMiB
      ? [Math.ceil((offered * residenceSeconds * r.memoryMiBPerMessage) / (target - r.baselineMemoryMiB))]
      : [];
  };
  if (c.kind === "cloudRun")
    return [
      ...(concurrency > 0
        ? [Math.ceil((offered * residenceSeconds) / ((concurrency * c.targetConcurrencyPct) / 100))]
        : []),
      ...cpuAt(r.cpuLimitMilli, c.targetCpuPct),
    ];
  if (c.kind === "aca") return c.http ? [Math.ceil(offered / c.http.concurrentRequests)] : [];
  if (c.kind === "ecs")
    return c.targetTracking.flatMap((p) =>
      p.metric === "cpu"
        ? cpuAt(r.cpuLimitMilli, p.target)
        : p.metric === "memory"
          ? memoryAt(r.memoryLimitMiB, p.target)
          : [Math.ceil((offered * 60) / p.target)],
    );
  if (c.kind === "appService")
    return c.rules.flatMap((rule) =>
      rule.direction !== "increase"
        ? []
        : rule.metric === "cpu"
          ? cpuAt(r.cpuLimitMilli ?? r.availableCpuMilli, rule.threshold)
          : rule.metric === "memory"
            ? memoryAt(r.memoryLimitMiB, rule.threshold)
            : [],
    );
  return [];
}

/** Configured arithmetic, not a promise about a burst or the current ready fleet. */
export function resourcePlan(
  p: ResolvedProps,
  offered: number,
  assigned: number,
  multiplier = 1,
  timing: ResolvedTiming = resolvedTiming(p),
  admitted = Infinity,
) {
  const r = p.resources;
  if (!r) return undefined;
  const c = p.autoscaling?.mode === "on" ? p.autoscaling.controller : undefined;
  const range = c ? replicaRange(c, multiplier) : undefined;
  const fixed = Math.max(1, Math.min(10_000, Math.round(p.replicas * multiplier)));
  const perReplica = resourceCapacity(r, p.concurrency, timing.threadHoldMs);
  const metrics = c && "settings" in c ? c.settings.metrics : [];
  const targetValue = (m: (typeof metrics)[number]) =>
    m.target.kind === "averageValue"
      ? m.target.value
      : ((m.source.kind === "pods"
          ? p.concurrency
          : m.source.resource === "cpu"
            ? (r.cpuRequestMilli ?? 0)
            : (r.memoryRequestMiB ?? 0)) *
          m.target.percentOfRequest) /
        100;
  const cpuMilli = r.cpuLimitMilli ?? r.availableCpuMilli ?? Infinity;
  const residenceSeconds = Math.max(timing.memoryResidenceMs / 1000, (r.cpuMsPerMessage * p.concurrency) / cpuMilli);
  const memoryOccupancy =
    timing.memoryResidenceMs > timing.threadHoldMs
      ? Math.min(
          (admitted / Math.max(1, assigned)) * residenceSeconds,
          Math.max(
            p.concurrency,
            (Math.min(offered, assigned * perReplica) / Math.max(1, assigned)) * residenceSeconds,
          ),
        )
      : p.concurrency;
  const memoryPeakMiB = r.baselineMemoryMiB + memoryOccupancy * r.memoryMiBPerMessage;
  const needed = [
    ...metrics.flatMap((m) => {
      const target = targetValue(m);
      if (m.source.kind === "pods") return target ? [Math.ceil((offered * timing.threadHoldMs) / 1000 / target)] : [];
      if (m.source.resource === "cpu")
        return target && r.cpuMsPerMessage ? [Math.ceil((offered * r.cpuMsPerMessage) / target)] : [];
      return target > r.baselineMemoryMiB
        ? [Math.ceil((offered * residenceSeconds * r.memoryMiBPerMessage) / (target - r.baselineMemoryMiB))]
        : [];
    }),
    ...(c ? cloudNeeded(c, r, offered, p.concurrency, residenceSeconds) : []),
  ];
  const targetReplicas = needed.length ? Math.max(range?.min ?? 1, ...needed) : undefined;
  const polled = c?.kind === "keda" || (c?.kind === "aca" && c.triggers.length > 0) ? c : undefined;
  return {
    ...(unmeasured(r) ? { unmeasured: true } : {}),
    ...(polled
      ? {
          keda: {
            pollingMs: polled.pollingMs,
            cooldownMs: polled.cooldownMs,
            lagBeforePoll: range?.initial === 0 ? Math.ceil((offered * polled.pollingMs) / 1000) : 0,
            offered,
          },
        }
      : {}),
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
    memoryPeakMiB,
    memoryRisk: r.memoryLimitMiB !== undefined && memoryPeakMiB > r.memoryLimitMiB,
    baselineAboveTarget: metrics.some(
      (m) =>
        m.source.kind === "resource" &&
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
