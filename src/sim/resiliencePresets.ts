import type { RetryPolicy } from "../model/admission";

/** gRPC A6 attempt counting, AWS standard full jitter, Finagle's ten-second budget.
 * Backoff values are shortened for lessons lasting tens of seconds. */
export const RECOMMENDED_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 100,
  strategy: "exponential",
  maxBackoffMs: 2000,
  jitter: 1,
  retryOn: ["throttled"],
  budget: { percent: 20, minPerSec: 10 },
};

export function retryIdempotency(policy: RetryPolicy | undefined, method?: string): boolean | "unknown" {
  if (policy?.idempotent !== undefined) return policy.idempotent;
  if (method && ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method)) return true;
  if (method === "POST" || method === "PATCH") return false;
  return "unknown";
}

export function recommendedRetry(method?: string): RetryPolicy {
  return {
    ...structuredClone(RECOMMENDED_RETRY),
    retryOn: retryIdempotency(undefined, method) === true ? ["throttled", "transient", "timeout"] : ["throttled"],
  };
}

/** Queue wait fits inside the caller's deadline, rounded down to the readable 1/2/3/4/6/8 series.
 * Adaptive LIFO (Fail at Scale): keep fresh requests useful and refuse stale work lazily. */
export function recommendedQueue(
  deadlineMs: number | undefined,
  responseMs: number,
  threads: number,
): import("./types").QueuePolicy | undefined {
  const room = (deadlineMs ?? 0) - responseMs;
  if (!(room >= 1) || !(responseMs > 0) || !Number.isFinite(threads) || threads < 1) return;
  let unit = 1;
  while (unit * 10 <= room) unit *= 10;
  const maxWaitMs = [8, 6, 4, 3, 2, 1].map((n) => n * unit).find((n) => n <= room)!;
  return {
    limit: Math.min(1_000_000, Math.max(Math.ceil(threads), Math.floor((threads * maxWaitMs) / responseMs))),
    order: "lifo",
    maxWaitMs,
  };
}
