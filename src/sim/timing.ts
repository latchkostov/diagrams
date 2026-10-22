import type { ResolvedProps } from "./defaults";

export const STEP = 10;

/** A callee's selected endpoint work plus downstream residence and round-trip network delay.
 * Replace the plan's default work rather than losing endpoint latency when it has downstream calls. */
export function requestResponseMs(
  props: ResolvedProps,
  waiting?: Pick<ResolvedTiming, "workMs" | "memoryResidenceMs">,
  endpointId?: string,
  networkDelayMs = 0,
): number {
  return (
    resolvedTiming(props, 0, endpointId).workMs +
    (waiting ? waiting.memoryResidenceMs - waiting.workMs : 0) +
    2 * Math.max(0, networkDelayMs)
  );
}

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
