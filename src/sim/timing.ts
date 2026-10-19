import type { ResolvedProps } from "./defaults";

/** Executing time and total slot/memory residence, in simulation milliseconds. */
export interface ResolvedTiming {
  workMs: number;
  holdMs: number;
}

export function overrideWork(timing: ResolvedTiming, workMs = timing.workMs): ResolvedTiming {
  return { workMs, holdMs: workMs + (timing.holdMs - timing.workMs) };
}

export function resolvedTiming(p: ResolvedProps, callMs = 0, endpointId?: string): ResolvedTiming {
  const workMs =
    p.admission?.endpoints.find((e) => e.id === endpointId)?.behaviour?.latencyMs ??
    p.admission?.api.latencyMs ??
    p.latencyMs;
  return { workMs, holdMs: workMs + callMs };
}
