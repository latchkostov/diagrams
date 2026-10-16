// The Node benchmarks' harness (docs/BENCHMARKS.md): modes, timing with warm-up and calibrated batches, gates, and
// one part file per suite. Every suite is a Vitest file run by tests/bench/vitest.config.ts (`pnpm bench:node`).
//
// - Timings (`timing`) are report-only: medians and percentiles of several samples, normalised by the calibration
//   run in the same process. They never fail a run.
// - Gates (`gating`) are the robust kinds only: complexity ratios from growth() (src/test/complexity.ts) and
//   operation counts. They fail the run, and they're all that BENCH_MODE=gates runs.

import { afterAll, beforeAll, expect, it } from "vitest";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../../../src/test/complexity";
import { describeWorkload, SIZES, workload as generate, type Family } from "../../../src/bench/workloads";
import type { DiagramFile } from "../../../src/model/types";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { workloadFile } from "../workloadCache";
import { calibrate } from "../calibration";
import { gate, Recorder, stats, type Stats, type WorkloadInfo } from "../results";

/** full: every size, report-only timings and gates; gates: the gates only; quick: small sizes, fewer samples. */
export const MODE = (process.env.BENCH_MODE ?? "full") as "full" | "gates" | "quick";
if (!["full", "gates", "quick"].includes(MODE)) throw new Error(`BENCH_MODE must be full, gates or quick: ${MODE}`);

/** The sizes timings run at. BENCH_SIZES (e.g. "100,500") narrows them. */
export const SIZES_RUN: number[] = process.env.BENCH_SIZES
  ? process.env.BENCH_SIZES.split(",").map(Number)
  : MODE === "quick"
    ? [100, 500]
    : [...SIZES];

/** Samples per timing: fewer for the biggest inputs, where each sample is long and steady. */
export const samplesFor = (n: number) => (MODE === "quick" ? 5 : n >= 5_000 ? 7 : n >= 1_500 ? 11 : 15);

/**
 * Gate sizes: the large input is GROWTH_FACTOR times the small one (docs/QUALITY.md § Timing in tests). 500 rather
 * than smaller: below a few hundred nodes, allocation-heavy code still fits in the young generation and runs several
 * times faster per node, which reads as superlinear growth (fromFlow: 25x from 250 to 2,000, 9x from 500 to 4,000).
 */
export const GATE_SMALL = 500;
export const GATE_LARGE = GATE_SMALL * GROWTH_FACTOR;
export { GROWTH_FACTOR, LINEAR_LIMIT };

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});

/** Milliseconds for `reps` calls of `run`. */
function batch(run: () => unknown, reps: number): number {
  const t = performance.now();
  for (let i = 0; i < reps; i++) run();
  return performance.now() - t;
}

export interface MeasureOptions {
  samples?: number;
  /** Untimed calls first (JIT, caches). */
  warmup?: number;
  /** A sample lasts at least this long: short calls are batched and divided. */
  minMs?: number;
  /** Stop sampling after this long (at least 3 samples). */
  budgetMs?: number;
}

/**
 * How many samples a call this slow gets: every one asked for, but 3 for a call over 5 s and 1 for one over 20 s (the
 * biggest routing workloads take a minute a call; their spread is small next to that, and a run must end).
 */
const samplesForCall = (ms: number, asked: number) => (ms > 20_000 ? 1 : ms > 5_000 ? Math.min(3, asked) : asked);

/**
 * Per-call milliseconds of `run`: `samples` batches after a warm-up, a full GC before each (when Node runs with
 * --expose-gc, as the bench config does), each batch long enough for the timer.
 */
export function measure(run: () => unknown, o: MeasureOptions = {}): Stats {
  const { warmup = 2, minMs = 25, budgetMs = 20_000 } = o;
  const first = batch(run, 1);
  // One warm-up is enough for a call that takes seconds.
  if (first < 2_000) for (let i = 1; i < warmup; i++) run();
  const samples = samplesForCall(first, o.samples ?? 15);
  let reps = 1;
  if (first < minMs)
    for (let ms = batch(run, 1); ms < minMs && reps < 1_000_000; ms = batch(run, reps))
      reps = Math.min(1_000_000, reps * Math.max(2, Math.ceil(minMs / Math.max(ms, 0.01))));
  const out: number[] = [];
  const start = performance.now();
  for (let i = 0; i < samples; i++) {
    gc();
    out.push(batch(run, reps) / reps);
    if (i >= 2 && performance.now() - start > budgetMs) break;
  }
  return stats(out);
}

/**
 * Per-call milliseconds of a call that changes its input: `make` builds a fresh one (untimed) for every sample, and
 * the call it returns is timed once.
 */
export function measureFresh(make: () => () => unknown, o: MeasureOptions = {}): Stats {
  const { warmup = 2, budgetMs = 30_000 } = o;
  let first = 0;
  for (let i = 0; i < warmup; i++) {
    const run = make();
    const t = performance.now();
    run();
    first = performance.now() - t;
    if (first > 2_000) break;
  }
  const samples = samplesForCall(first, o.samples ?? 15);
  const out: number[] = [];
  const start = performance.now();
  for (let i = 0; i < samples; i++) {
    const run = make();
    gc();
    const t = performance.now();
    run();
    out.push(performance.now() - t);
    if (i >= 2 && performance.now() - start > budgetMs) break;
  }
  return stats(out);
}

export const workloadInfo = (family: string, n: number, d: DiagramFile): WorkloadInfo => {
  const w = describeWorkload(d);
  return { family, n, nodes: w.nodes, edges: w.edges, fingerprint: w.fingerprint };
};

/** A benchmark suite: its recorder, calibration and the three kinds of test. Call once at the top of a file. */
export function suite(name: string) {
  const rec = new Recorder(name, "node");
  let start = 0;
  beforeAll(() => {
    start = calibrate().ms;
  });
  afterAll(() => {
    const end = calibrate().ms;
    rec.info.calibrationStartMs = start;
    rec.info.calibrationEndMs = end;
    rec.info.mode = MODE;
    rec.info.exposeGc = !!(globalThis as { gc?: unknown }).gc;
    rec.write((start + end) / 2);
  });
  const id = (...parts: (string | number | undefined)[]) => [name, ...parts.filter((p) => p !== undefined)].join("/");
  return {
    rec,
    /** A report-only timing scenario (not run with BENCH_MODE=gates). */
    timing: (title: string, fn: () => void | Promise<void>, timeout = 900_000) =>
      (MODE === "gates" ? it.skip : it)(title, fn, timeout),
    /** A gate: runs in every mode, fails the run when it doesn't hold. */
    gating: (title: string, fn: () => void | Promise<void>, timeout = 300_000) => it(title, fn, timeout),
    /** Records a timing for `scenario` on a workload. */
    time(scenario: string, s: Stats, w?: WorkloadInfo, detail?: string, note?: string) {
      return rec.add({
        id: id(scenario, detail, w && `${w.family}@${w.n}`),
        scenario,
        kind: "time",
        unit: "ms",
        value: s.median,
        stats: s,
        ...(w ? { workload: w } : {}),
        ...(note ? { note } : {}),
      });
    },
    /** Records a count; with `limit`, it's a gate that must hold (`value <= limit` unless `op` says otherwise). */
    count(
      scenario: string,
      value: number,
      o: {
        w?: WorkloadInfo;
        detail?: string;
        unit?: string;
        limit?: number;
        op?: "<=" | ">=" | "==";
        why?: string;
      } = {},
    ) {
      const g = o.limit === undefined ? undefined : gate(o.op ?? "<=", value, o.limit, o.why);
      rec.add({
        id: id(scenario, o.detail, o.w && `${o.w.family}@${o.w.n}`),
        scenario,
        kind: "count",
        unit: o.unit ?? "count",
        value,
        ...(o.w ? { workload: o.w } : {}),
        ...(g ? { gate: g } : {}),
      });
      if (g)
        expect.soft(g.pass, `${scenario}${o.detail ? ` ${o.detail}` : ""}: ${value} ${g.op} ${g.limit}`).toBe(true);
    },
    /**
     * A complexity gate: how much longer `large` takes than `small` (GROWTH_FACTOR times the input), fastest of
     * several interleaved runs. Must stay under `limit` (LINEAR_LIMIT: linear is about 8, quadratic 64).
     */
    growth(scenario: string, small: () => unknown, large: () => unknown, limit = LINEAR_LIMIT, why?: string) {
      const ratio = growth(small, large, { samples: 5, minMs: 10 });
      const g = gate("<=", ratio, limit, why);
      rec.add({ id: id(scenario, "growth"), scenario, kind: "ratio", unit: "x", value: ratio, gate: g });
      expect.soft(ratio, `${scenario}: ${ratio.toFixed(1)}x for ${GROWTH_FACTOR}x the input`).toBeLessThan(limit);
      return ratio;
    },
  };
}

/** Workloads to time: every family at every size (BENCH_FAMILIES narrows the families). */
export function cases(families: readonly Family[], sizes: readonly number[] = SIZES_RUN) {
  const only = process.env.BENCH_FAMILIES?.split(",");
  return families
    .filter((f) => !only || only.includes(f))
    .flatMap((family) => sizes.map((n) => ({ family, n, title: `${family}@${n}` })));
}

/**
 * The workload `family` at about `n` nodes: read from the materialised copy (tests/.output/bench/workloads/<key>, written by
 * the first suite that needs it, and read by the browser benchmarks), else generated and written there. Generating
 * the biggest imported ones takes seconds; the copy is byte for byte the same (its fingerprint is in every result).
 */
export function workload(family: Family, n: number): DiagramFile {
  const file = workloadFile(family, n);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as DiagramFile;
  const d = generate(family, n);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(d));
  return d;
}
