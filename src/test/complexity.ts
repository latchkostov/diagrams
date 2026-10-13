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
 * Milliseconds per call of `run`, the fastest of `samples` after a warm-up. Each sample repeats the call until it
 * has run for at least `minMs`, so a call much shorter than the timer's resolution or a scheduler tick still
 * measures cleanly.
 */
export function fastest(run: () => unknown, { samples = 5, minMs = 4 } = {}): number {
  const reps = repsFor(run, minMs);
  let best = Infinity;
  for (let i = 0; i < samples; i++) best = Math.min(best, sample(run, reps));
  return best;
}

/**
 * How much longer the large input takes than the small one: `fastest(large) / fastest(small)`. The samples of the
 * two sizes interleave, so a burst of load elsewhere slows both. With large = GROWTH_FACTOR × small, compare the
 * result against LINEAR_LIMIT.
 */
export function growth(small: () => unknown, large: () => unknown, { samples = 5, minMs = 4 } = {}): number {
  const smallReps = repsFor(small, minMs);
  const largeReps = repsFor(large, minMs);
  let bestSmall = Infinity;
  let bestLarge = Infinity;
  for (let i = 0; i < samples; i++) {
    bestSmall = Math.min(bestSmall, sample(small, smallReps));
    bestLarge = Math.min(bestLarge, sample(large, largeReps));
  }
  return report(bestSmall, bestLarge);
}

/** The async form of `growth`, for work that awaits (an import through the format registry). */
export async function growthAsync(
  small: () => Promise<unknown>,
  large: () => Promise<unknown>,
  { samples = 3 } = {},
): Promise<number> {
  const time = async (run: () => Promise<unknown>) => {
    const start = performance.now();
    await run();
    return performance.now() - start;
  };
  await small();
  await large();
  let bestSmall = Infinity;
  let bestLarge = Infinity;
  for (let i = 0; i < samples; i++) {
    bestSmall = Math.min(bestSmall, await time(small));
    bestLarge = Math.min(bestLarge, await time(large));
  }
  return report(bestSmall, bestLarge);
}

/** The ratio; GROWTH_LOG=1 prints each one with its timings (run with --silent=false). */
function report(small: number, large: number): number {
  const ratio = large / Math.max(small, 1e-6);
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.GROWTH_LOG)
    console.log(`growth ${ratio.toFixed(1)}x (${small.toFixed(3)} ms -> ${large.toFixed(3)} ms)`);
  return ratio;
}

/** Warms `run` up and returns how many calls make a sample of at least `minMs`. */
function repsFor(run: () => unknown, minMs: number): number {
  const once = sample(run, 1);
  return Math.max(1, Math.min(1_000, Math.ceil(minMs / Math.max(once, 1e-3))));
}

function sample(run: () => unknown, reps: number): number {
  const start = performance.now();
  for (let i = 0; i < reps; i++) run();
  return (performance.now() - start) / reps;
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
