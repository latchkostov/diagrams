/** Logical state only. Reservations may outlive this record's answer, never change it. */
export interface Attempt<Message = unknown> {
  id: number;
  node: string;
  message: Message;
  admittedAt: number;
  call?: LogicalCall;
  outcome?: Readonly<{ ok: boolean; code?: number; at: number }>;
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
  state: "queued" | "sent" | "replied" | "failed" | "timedOut" | "backoff";
  attempt?: number;
  retryEvent?: number;
  expiresAt: number;
  deadlineEvent?: number;
  pool?: number;
}

export function settleOnce(a: Attempt, ok: boolean, code: number | undefined, at: number): boolean {
  if (a.outcome) return false;
  a.outcome = { ok, code, at };
  return true;
}

/** Equal-time replies lose to the deadline regardless of heap insertion order. */
export function raceReply(branch: Pick<LogicalBranch, "expiresAt">, at: number): "reply" | "timeout" {
  return at < branch.expiresAt ? "reply" : "timeout";
}
