import { suggestedDeadlineMs } from "../sim/callPolicy";
import { STEP } from "../sim/timing";

/**
 * When playback delivers a normal reply, measured from the call: the request lands on the tick after its network
 * delay, the callee's work ends on a tick, and the reply arrives its network delay later. `responseMs` is the nominal
 * response (requestResponseMs: the callee's time plus both network legs). A deadline must be strictly later: at
 * exactly this time, the timeout wins.
 */
export function playbackResponseMs(responseMs: number, networkDelayMs = 0, jitter = 0): number {
  const net = Math.max(0, networkDelayMs);
  // Latency jitter stretches the callee's time by up to this fraction.
  const local = Math.max(0, responseMs - 2 * net) * (1 + Math.max(0, jitter));
  const tick = (ms: number) => Math.ceil(ms / STEP - 1e-9) * STEP;
  return tick(local) + tick(net) + net;
}

/** Little's law: rate × wait ≤ threads. Reserve 10% for local work and rounding,
 * then round down to a readable 1/2/3/4/6/8 value. The proposal is strictly later than playback's completion
 * (tick-rounded, jitter's maximum included), else none; a same-seed replay then decides whether it's offered
 * (src/live/threadFixPlan.ts timeoutKeepsReplies).
 * 100 threads at 120–140 arrivals/s afford 600 ms, rather than the old 1 s floor. */
export function affordableTimeout(
  responseMs: number,
  threads: number,
  arrivalRate: number,
  networkDelayMs = 0,
  jitter = 0,
): number | undefined {
  const completes = playbackResponseMs(responseMs, networkDelayMs, jitter);
  if (!(arrivalRate > 0) || !Number.isFinite(threads)) {
    const suggested = suggestedDeadlineMs(responseMs);
    return suggested > completes ? suggested : undefined;
  }
  const ceiling = Math.min(600_000, (0.9 * threads * 1000) / arrivalRate);
  const unit = 10 ** Math.floor(Math.log10(ceiling));
  const rounded = [...[1, 2, 3, 4, 6, 8].map((n) => n * unit), (unit / 10) * 8]
    .filter((n) => n <= ceiling)
    .sort((a, b) => b - a)[0];
  return rounded > completes && rounded >= 1 ? Math.floor(rounded) : undefined;
}
