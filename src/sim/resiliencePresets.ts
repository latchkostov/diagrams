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
