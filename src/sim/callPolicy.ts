import type { EdgeSimProps } from "./types";
import { holdsCallerThread } from "../stencils/freeCallerProfiles";

export interface CallPolicy {
  blocking: boolean;
  replyMs: number;
  pool?: number;
  deadlineMs?: number;
}

export const replyCpuMs = (cpuMs: number, replies: number) => cpuMs * 0.1 * replies;

/** Shared by playback, planning and connection editing. Older revisions never execute it. */
export function callPolicy(stencil: string, caller?: EdgeSimProps["caller"]): CallPolicy {
  const blocking = holdsCallerThread(stencil, caller?.wait);
  return {
    blocking,
    replyMs: blocking ? 0 : (caller?.replyMs ?? 10),
    pool: caller?.poolConnections,
    deadlineMs: caller?.deadlineMs ?? undefined,
  };
}

/** A deadline bounds the logical response, including physical travel, in either mode. */
export const callResponseMs = (policy: CallPolicy, responseMs: number) =>
  Math.min(responseMs, policy.deadlineMs ?? Infinity);

/** Playback and steady-state planning agree on which reply wins the deadline. */
export function callOutcome(policy: CallPolicy, responseMs: number, failed = false) {
  const timedOut = policy.deadlineMs !== undefined && responseMs >= policy.deadlineMs;
  return { responseMs: callResponseMs(policy, responseMs), timedOut, failed: failed || timedOut };
}

/** Four expected responses, rounded up to 1–2–5, with a one-second floor. */
export function suggestedDeadlineMs(responseMs: number): number {
  const target = Math.min(600_000, Math.max(1000, Number.isFinite(responseMs) ? responseMs * 4 : 1000));
  for (let unit = 1000; unit <= 100_000; unit *= 10)
    for (const factor of [1, 2, 5]) if (unit * factor >= target) return unit * factor;
  return 600_000;
}
