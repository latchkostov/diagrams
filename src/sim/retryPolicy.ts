import type { RetryPolicy } from "../model/admission";
import { STEP } from "./timing";

export type RetryClass = RetryPolicy["retryOn"][number];

/** An attempt's own timeout differs from a 504 propagated from downstream. */
export function classifyOutcome(outcome: {
  ok?: boolean;
  code?: number;
  timeout?: boolean;
  local?: boolean;
}): RetryClass | undefined {
  if (outcome.ok || outcome.local) return undefined;
  if (outcome.timeout) return "timeout";
  if (outcome.code === 429) return "throttled";
  if (outcome.code !== undefined && outcome.code >= 500 && outcome.code <= 599) return "transient";
  return undefined;
}

/** k is one for the first retry. Integer multiplication keeps cross-engine determinism. */
export function backoffDelay(policy: RetryPolicy, k: number, u = 0): number {
  let delay = policy.backoffMs;
  if (policy.strategy === "exponential") {
    const cap = policy.maxBackoffMs ?? Math.min(600_000, 20 * policy.backoffMs);
    for (let i = 1; i < k && delay < cap; i++) delay = Math.min(cap, delay * 2);
    delay = Math.min(cap, delay);
  }
  return Math.ceil(Math.max(STEP, delay * (1 - (policy.jitter ?? 0) * u)) / STEP) * STEP;
}

/** Expected load and residence, capped at the same ten attempts as playback. */
export function expectedRetries(policy: RetryPolicy, probability: number, requestsPerSec = 0) {
  let attempts = 1,
    backoffMs = 0,
    reach = 1;
  const m = Math.min(policy.maxAttempts, 10);
  for (let k = 1; k < m; k++) {
    reach *= probability;
    attempts += reach;
    backoffMs += reach * backoffDelay(policy, k, 0.5);
  }
  if (policy.budget) {
    const allowance = Math.max(
      policy.budget.percent / 100,
      requestsPerSec > 0 ? (policy.budget.minPerSec ?? 10) / requestsPerSec : 0,
    );
    const factor = Math.min(1, allowance / Math.max(1e-12, attempts - 1));
    backoffMs *= factor;
    attempts = 1 + (attempts - 1) * factor;
  }
  return { attempts, backoffMs };
}

export interface RetryWindow {
  buckets: { second: number; requests: number; attempts: number; retried: number; succeeded: number }[];
}
export const createRetryWindow = (): RetryWindow => ({ buckets: [] });
export function retryWindow(window: RetryWindow, now: number) {
  const second = Math.floor(now / 1000);
  return window.buckets.reduce(
    (total, b) => {
      if (b.second > second - 10 && b.second <= second) {
        total.requests += b.requests;
        total.attempts += b.attempts;
        total.retried += b.retried;
        total.succeeded += b.succeeded;
      }
      return total;
    },
    { requests: 0, attempts: 0, retried: 0, succeeded: 0 },
  );
}
export function recordRetryWindow(
  window: RetryWindow,
  now: number,
  field: "requests" | "attempts" | "retried" | "succeeded",
  units: number,
): void {
  const second = Math.floor(now / 1000),
    index = second % 10;
  let bucket = window.buckets[index];
  if (!bucket || bucket.second !== second)
    window.buckets[index] = bucket = { second, requests: 0, attempts: 0, retried: 0, succeeded: 0 };
  bucket[field] += units;
}

export type RetryDisposition = "none" | "broker" | "inplace";

/** Decide from the pre-failure attempt count, before counters or ownership change. */
export function retryDisposition(state: {
  delivery: boolean;
  inplace: boolean;
  attempts: number;
  maxDeliveryCount: number;
  retain: () => boolean;
}): RetryDisposition {
  if (!state.delivery) return "none";
  return state.inplace && state.attempts + 1 < state.maxDeliveryCount && state.retain() ? "inplace" : "broker";
}
