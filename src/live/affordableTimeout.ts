import { suggestedDeadlineMs } from "../sim/callPolicy";

/** Little's law: rate × wait ≤ threads. Reserve 10% for local work and rounding,
 * then round down to a readable 1/2/3/4/6/8 value. Never cut off a normal reply.
 * 100 threads at 120–140 arrivals/s afford 600 ms, rather than the old 1 s floor. */
export function affordableTimeout(responseMs: number, threads: number, arrivalRate: number): number | undefined {
  if (!(arrivalRate > 0) || !Number.isFinite(threads)) return suggestedDeadlineMs(responseMs);
  const ceiling = Math.min(600_000, (0.9 * threads * 1000) / arrivalRate);
  const unit = 10 ** Math.floor(Math.log10(ceiling));
  const rounded = [...[1, 2, 3, 4, 6, 8].map((n) => n * unit), (unit / 10) * 8]
    .filter((n) => n <= ceiling)
    .sort((a, b) => b - a)[0];
  return rounded > responseMs && rounded >= 1 ? Math.floor(rounded) : undefined;
}
