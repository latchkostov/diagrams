import type { ResolvedProps } from "./defaults";

/** Thread occupancy and retained request memory have independent lifetimes. */
export interface ResolvedTiming {
  workMs: number;
  threadHoldMs: number;
  memoryResidenceMs: number;
}

export function overrideWork(timing: ResolvedTiming, workMs = timing.workMs): ResolvedTiming {
  return {
    workMs,
    threadHoldMs: workMs + (timing.threadHoldMs - timing.workMs),
    memoryResidenceMs: workMs + (timing.memoryResidenceMs - timing.workMs),
  };
}

export function resolvedTiming(
  p: ResolvedProps,
  callMs = 0,
  endpointId?: string,
  residenceMs = callMs,
): ResolvedTiming {
  const workMs =
    p.admission?.endpoints.find((e) => e.id === endpointId)?.behaviour?.latencyMs ??
    p.admission?.api.latencyMs ??
    p.latencyMs;
  return { workMs, threadHoldMs: workMs + callMs, memoryResidenceMs: workMs + residenceMs };
}
