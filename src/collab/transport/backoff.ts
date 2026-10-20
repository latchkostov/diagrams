import type { RandomBytes } from "../random";

/** The public tracker and relay share bounded exponential backoff with 50–100% jitter. */
export function reconnectDelay(failures: number, random: RandomBytes): number {
  return Math.min(120_000, 1_000 * 2 ** Math.min(failures, 7)) * (0.5 + random(1)[0] / 510);
}
