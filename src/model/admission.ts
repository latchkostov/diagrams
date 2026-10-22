/** P3 admission uses real units. Missing budgets mean unknown, never unlimited. */
export const QUOTA_UNITS = ["requests", "tokens", "inputTokens", "outputTokens", "costPoints", "bytes"] as const;
export type QuotaUnit = (typeof QUOTA_UNITS)[number];
export interface Quota {
  id: string;
  unit: QuotaUnit;
  amount: number;
  windowMs: number;
  algorithm: "token-bucket";
  burst?: number;
  sharedGroup?: string;
}
export interface SharedAllocation {
  id: string;
  maxInFlight: number;
}
export interface ApiBehaviour {
  quotas?: Quota[];
  maxInFlight?: number;
  sharedConcurrency?: string;
  latencyMs?: number;
  errorRate?: number;
  /** A request budget always charges one per request; other units use the declared workload size. */
  costPerRequest?: Partial<Record<QuotaUnit, number>>;
}
/** Endpoint authoring/discovery UI belongs to P6; P3 enforces the file contract. */
export interface ApiEndpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
  path: string;
  behaviour?: ApiBehaviour;
}
/** Caller retries execute from p3-w2; older revisions preserve this policy dormant. */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  strategy: "fixed" | "exponential";
  maxBackoffMs?: number;
  budget?: { percent: number; minPerSec?: number };
  jitter?: number;
  retryOn: ("throttled" | "transient" | "timeout")[];
  idempotent?: boolean;
}

/** One connection, shared across replicas. Shortened resilience4j defaults suit short lessons. */
export interface BreakerPolicy {
  failurePercent?: number;
  slowCallMs?: number;
  slowPercent?: number;
  windowMs?: number;
  minimumCalls?: number;
  openMs?: number;
  halfOpenCalls?: number;
}
