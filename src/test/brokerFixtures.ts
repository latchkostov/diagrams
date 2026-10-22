import { STEP } from "../sim/timing";

/**
 * A connection long enough that a broker delivers a dot of `represented` real requests whole to a consumer with
 * `slots` slots of `latencyMs` each: the consumer's prefetch window (slots + ⌈slots × travel ÷ service⌉ + 1 real
 * requests) then holds the dot. For tests that follow one cohort at the consumer. Otherwise a broker delivers what the
 * window holds and keeps the rest queued, as at scale 1.
 */
export function wholeDotTravelMs(represented: number, slots: number, latencyMs: number): number {
  const service = Math.max(STEP, latencyMs);
  return Math.max(STEP, Math.ceil((represented - slots - 1) / slots) * service);
}
