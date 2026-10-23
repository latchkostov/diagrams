import type { BreakerPolicy } from "../model/admission";
import { breakerProbePermits, throttleSplit } from "./admission";
import { classifyOutcome, type OutcomeKind } from "./retryPolicy";

export const BREAKER_DEFAULTS = {
  failurePercent: 50,
  slowPercent: 100,
  windowMs: 10000,
  minimumCalls: 20,
  openMs: 5000,
  halfOpenCalls: 5,
} as const;
export interface BreakerState {
  state: "closed" | "open" | "half-open";
  generation: number;
  openedAt: number;
  lastWindow?: { calls: number; failed: number; slow: number };
  sent: number;
  settled: number;
  recorded: number;
  failed: number;
  slow: number;
  inFlight: number;
  buckets: { second: number; calls: number; failed: number; slow: number }[];
}
export interface BreakerView {
  state: BreakerState["state"];
  remainingMs: number;
  probesSent: number;
  probesSettled: number;
  probesInFlight: number;
  probes: number;
  failurePercent: number;
  calls: number;
}
export interface BreakerPermit {
  generation: number;
  probe: boolean;
  units: number;
  /** Immutable admission evidence: another queued probe may dispatch first. */
  sent: number;
}
export const createBreaker = (): BreakerState => ({
  state: "closed",
  generation: 0,
  openedAt: 0,
  sent: 0,
  settled: 0,
  recorded: 0,
  failed: 0,
  slow: 0,
  inFlight: 0,
  buckets: [],
});
export function breakerWindow(b: BreakerState, p: BreakerPolicy, now: number) {
  const second = Math.floor(now / 1000),
    seconds = (p.windowMs ?? BREAKER_DEFAULTS.windowMs) / 1000;
  return b.buckets.reduce(
    (sum, v) => {
      if (v.second > second - seconds && v.second <= second) {
        sum.calls += v.calls;
        sum.failed += v.failed;
        sum.slow += v.slow;
      }
      return sum;
    },
    { calls: 0, failed: 0, slow: 0 },
  );
}
function transition(b: BreakerState, state: BreakerState["state"], now: number) {
  b.state = state;
  b.generation++;
  b.sent = b.settled = b.recorded = b.failed = b.slow = b.inFlight = 0;
  if (state === "open") b.openedAt = now;
  b.buckets = [];
  if (state !== "open") b.lastWindow = undefined;
}
/**
 * Lazy open expiry; no timers or random draws. A permit precedes pool admission. Half-open, a cohort larger than
 * the batch's remaining room is narrowed to it (the throttle split): the permit's units are the admitted test
 * calls, and the caller short-circuits the rest, as scale 1 lets through only that many of a burst.
 */
export function breakerPermits(b: BreakerState, p: BreakerPolicy, now: number, units: number) {
  if (b.state === "open" && now >= b.openedAt + (p.openMs ?? BREAKER_DEFAULTS.openMs)) transition(b, "half-open", now);
  if (b.state === "open") return;
  const probe = b.state === "half-open";
  if (probe) {
    const part = throttleSplit(units, (p.halfOpenCalls ?? BREAKER_DEFAULTS.halfOpenCalls) - b.sent);
    if (!part) return;
    units = part.admitted;
    b.sent += units;
    b.inFlight += units;
  }
  return { generation: b.generation, probe, units, sent: b.sent };
}
/** Only the current epoch's logical answers count. Late replies and short circuits never enter the window. */
export function breakerRecord(
  b: BreakerState,
  p: BreakerPolicy,
  now: number,
  cause: OutcomeKind,
  elapsed: number,
  permit: BreakerPermit,
): void {
  if (permit.generation !== b.generation) return;
  const counts = classifyOutcome(cause).breakerCounts;
  const failed = counts === "failure" || counts === "slow";
  const slow = counts === "slow" || (p.slowCallMs !== undefined && elapsed >= p.slowCallMs);
  const recorded = counts !== "ignored" && counts !== "not-recorded" && !(permit.probe && cause === "shed");
  const failurePercent = p.failurePercent ?? BREAKER_DEFAULTS.failurePercent;
  const slowPercent = p.slowPercent ?? BREAKER_DEFAULTS.slowPercent;
  if (permit.probe && b.state === "half-open") {
    b.inFlight = Math.max(0, b.inFlight - permit.units);
    b.settled += permit.units;
    // Every dispatch consumes the fixed batch; only health evidence enters its denominator.
    if (recorded) b.recorded += permit.units;
    if (recorded && failed) b.failed += permit.units;
    if (recorded && slow) b.slow += permit.units;
    // Admission uses real-request room, including the allocator's one-request
    // minimum. A fractional cohort can exhaust that room below the nominal cap.
    const room = (p.halfOpenCalls ?? BREAKER_DEFAULTS.halfOpenCalls) - b.sent;
    if (!breakerProbePermits(room, 1) && b.settled + 1e-9 >= b.sent) {
      b.lastWindow = { calls: b.recorded, failed: b.failed, slow: b.slow };
      transition(
        b,
        b.recorded === 0 || b.failed * 100 >= failurePercent * b.recorded || b.slow * 100 >= slowPercent * b.recorded
          ? "open"
          : "closed",
        now,
      );
    }
  } else if (b.state === "closed" && recorded) {
    const second = Math.floor(now / 1000),
      index = second % ((p.windowMs ?? BREAKER_DEFAULTS.windowMs) / 1000);
    let bucket = b.buckets[index];
    if (!bucket || bucket.second !== second) b.buckets[index] = bucket = { second, calls: 0, failed: 0, slow: 0 };
    bucket.calls += permit.units;
    if (failed) bucket.failed += permit.units;
    if (slow) bucket.slow += permit.units;
    const w = breakerWindow(b, p, now);
    if (
      w.calls >= (p.minimumCalls ?? BREAKER_DEFAULTS.minimumCalls) &&
      (w.failed * 100 >= failurePercent * w.calls || w.slow * 100 >= slowPercent * w.calls)
    ) {
      b.lastWindow = w;
      transition(b, "open", now);
    }
  }
}
export function breakerView(b: BreakerState, p: BreakerPolicy, now: number): BreakerView {
  const w = b.state === "open" && b.lastWindow ? b.lastWindow : breakerWindow(b, p, now);
  return {
    state: b.state,
    remainingMs: b.state === "open" ? Math.max(0, b.openedAt + (p.openMs ?? BREAKER_DEFAULTS.openMs) - now) : 0,
    probesSent: b.sent,
    probesSettled: b.settled,
    probesInFlight: b.inFlight,
    probes: p.halfOpenCalls ?? BREAKER_DEFAULTS.halfOpenCalls,
    calls: w.calls,
    failurePercent: w.calls ? (100 * w.failed) / w.calls : 0,
  };
}
