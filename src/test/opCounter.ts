/** Work observed by the Vitest-only transform; no clock, calibration or production hooks. */
export class OpCounter {
  readonly bySource = new Map<string, number>();
  private work = 0;

  constructor(
    private readonly limit = Infinity,
    private readonly sources?: readonly string[],
  ) {}

  add(work = 1, source = "explicit"): void {
    if (this.sources && !this.sources.includes(source)) return;
    this.work += work;
    if (this.work > this.limit) throw new Error(`Operation budget exceeded: ${this.work} > ${this.limit} (${source})`);
    this.bySource.set(source, (this.bySource.get(source) ?? 0) + work);
  }

  get total(): number {
    return this.work;
  }
}

const host = globalThis as typeof globalThis & { __ldOpCounter?: OpCounter };

/** Scoped and exception-safe. Setup/fixture creation belongs outside this callback. */
export function ops(run: () => unknown, limit = Infinity, sources?: readonly string[]): number {
  const previous = host.__ldOpCounter;
  const counter = new OpCounter(limit, sources);
  host.__ldOpCounter = counter;
  try {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === "function")
      throw new Error("ops() measures synchronous work; await setup before measuring");
    return counter.total;
  } finally {
    host.__ldOpCounter = previous;
  }
}

/** Each size runs exactly once. A missing probe fails instead of passing with 0/0 or a fake baseline. */
export function opGrowth(small: () => unknown, large: () => unknown, limit = 24, sources?: readonly string[]): number {
  const a = ops(small, Infinity, sources);
  const b = ops(large, a * limit, sources);
  if (!a || !b) throw new Error(`No operation probes observed (${a}, ${b})`);
  if (process.env.OP_LOG) console.info(`ops ${a} -> ${b}: ${(b / a).toFixed(3)}x`);
  return b / a;
}
