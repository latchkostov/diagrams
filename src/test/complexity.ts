// Complexity guards for unit tests (docs/QUALITY.md § Timing in tests). A test that guards how work grows compares
// two input sizes run on the same machine at the same moment, never a wall-clock budget: a busy machine or CI
// with coverage slows both sizes alike, but a quadratic slip still multiplies the work by 64 where linear is 8.
// Where the work can be counted (reads, calls, iterations), count it instead: counts don't depend on the clock.

/** How many times larger the large input is than the small one. */
export const GROWTH_FACTOR = 8;
/** The most a linear (or n log n) piece of work may grow at GROWTH_FACTOR: linear is about 8, quadratic 64. */
export const LINEAR_LIMIT = 24;
/** The same for work that is quadratic by design (each item against the ones before it): 64, where cubic is 512. */
export const QUADRATIC_LIMIT = 192;

/**
 * How much longer the large input takes than the small one, per call: the fastest of `samples` batches of each,
 * after a warm-up. The batches of the two sizes interleave, so a burst of load elsewhere slows both, and each batch
 * runs for at least `minMs` (see `calibrate`), so a call far shorter than the timer's resolution still measures
 * cleanly. With large = GROWTH_FACTOR × small, compare the result against LINEAR_LIMIT.
 */
export function growth(small: () => unknown, large: () => unknown, { samples = 5, minMs = 4 } = {}): number {
  const smallReps = calibrate(small, minMs);
  const largeReps = calibrate(large, minMs);
  let bestSmall = Infinity;
  let bestLarge = Infinity;
  for (let i = 0; i < samples; i++) {
    bestSmall = Math.min(bestSmall, batch(small, smallReps) / smallReps);
    bestLarge = Math.min(bestLarge, batch(large, largeReps) / largeReps);
  }
  return report(bestSmall, bestLarge);
}

/** The most calls in one batch: a call this cheap is a constant, whatever the batch measures. */
export const MAX_REPS = 1_000_000;

/**
 * How many calls of `run` make a batch of at least `minMs`, after a warm-up. Measured on warmed-up batches,
 * doubling (or more) until a batch reaches `minMs`, never from one cold call: a first call slowed by compiling or
 * a collection would otherwise pick one repetition for a call that takes microseconds. At most MAX_REPS.
 */
export function calibrate(run: () => unknown, minMs: number): number {
  batch(run, 3);
  let reps = 1;
  for (;;) {
    const ms = batch(run, reps);
    if (ms >= minMs || reps >= MAX_REPS) return reps;
    reps = Math.min(MAX_REPS, reps * Math.max(2, Math.ceil(minMs / Math.max(ms, 0.01))));
  }
}

/** The ratio; GROWTH_LOG=1 prints each one with its timings (run with --silent=false). */
function report(small: number, large: number): number {
  const ratio = large / Math.max(small, 1e-9);
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.GROWTH_LOG)
    console.log(`growth ${ratio.toFixed(1)}x (${small.toFixed(4)} ms -> ${large.toFixed(4)} ms)`);
  return ratio;
}

/** Milliseconds for `reps` calls of `run`. */
function batch(run: () => unknown, reps: number): number {
  const start = performance.now();
  for (let i = 0; i < reps; i++) run();
  return performance.now() - start;
}

/**
 * Wraps `items` so every read of an element is counted: `reads()` says how many so far. Reading the length or
 * iterating's bookkeeping doesn't count; each element handed out does.
 */
export function countingReads<T>(items: T[]): { items: T[]; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(items, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { items: proxy, reads: () => reads };
}
