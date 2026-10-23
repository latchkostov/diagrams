import type { OutcomeKind } from "./retryPolicy";

/**
 * One logical attempt's terminal result, written once. `cause` is its classified terminal cause, present only
 * where retries execute (p3-w2 with a retry policy); `ok` is always `cause === "success"` there. A join, its
 * continuation and every in-place retry are separate attempts, so no attempt's cause outlives it.
 */
export interface AttemptOutcome {
  ok: boolean;
  code?: number;
  at: number;
  cause?: OutcomeKind;
}

/** Logical state only. Reservations may outlive this record's answer, never change it. */
export interface Attempt<Message = unknown> {
  id: number;
  node: string;
  message: Message;
  admittedAt: number;
  call?: LogicalCall;
  outcome?: Readonly<AttemptOutcome>;
  committed: boolean;
  res: { thread?: number; request?: number };
}

export interface LogicalCall {
  backingOff?: number;
  backoffAt?: number;
  startedAt: number;
  blockingRemaining: number;
  depth: number;
  branches: Map<string, LogicalBranch>;
}

export interface LogicalBranch {
  breakerPermit?: import("./breaker").BreakerPermit;
  /** Real requests this branch still carries after a half-open breaker narrowed it to its test calls;
   * its attempts, retries and successes are sized by it. Undefined: the caller's whole cohort. */
  represented?: number;
  attemptStartedAt?: number;
  countedAt?: number;
  state: "queued" | "sent" | "replied" | "failed" | "timedOut" | "backoff";
  attempt?: number;
  retryEvent?: number;
  /** Dots this backoff added to its edge's backingOff gauge, released as charged. */
  backoffDots?: number;
  expiresAt: number;
  deadlineEvent?: number;
  pool?: number;
}

export function settleOnce(
  a: Attempt,
  ok: boolean,
  code: number | undefined,
  at: number,
  cause?: OutcomeKind,
): boolean {
  if (a.outcome) return false;
  a.outcome = cause === undefined ? { ok, code, at } : { ok, code, at, cause };
  return true;
}

/** Equal-time replies lose to the deadline regardless of heap insertion order. */
export function raceReply(branch: Pick<LogicalBranch, "expiresAt">, at: number): "reply" | "timeout" {
  return at < branch.expiresAt ? "reply" : "timeout";
}
