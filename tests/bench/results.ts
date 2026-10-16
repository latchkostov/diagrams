// The benchmark results contract (docs/BENCHMARKS.md § Output), shared by the Node (Vitest) and browser (Playwright)
// benchmarks and read by scripts/bench/*.mjs. Each suite writes one part file; `pnpm bench` merges them into
// results.json with the run's environment and calibration.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const SCHEMA = "livediagrams-bench/v1";

/**
 * - time: milliseconds (report-only; compared as a trend, normalised by the run's calibration).
 * - count: operations, renders, commits, bytes of DOM… deterministic, so a gate can hold them.
 * - ratio: a growth ratio (large / small at GROWTH_FACTOR), a complexity gate.
 * - bytes: sizes (bundle, heap).
 * - percent: a share (main-thread utilisation): never normalised, compared as a count.
 */
export type MetricKind = "time" | "count" | "ratio" | "bytes" | "percent";

export interface Stats {
  n: number;
  median: number;
  p90: number;
  min: number;
  max: number;
  mean: number;
  /** Coefficient of variation (stdev / mean): the run's own noise. */
  cov: number;
}

export interface WorkloadInfo {
  family: string;
  n: number;
  nodes: number;
  edges: number;
  fingerprint?: string;
}

export interface Gate {
  /** The comparison that must hold: value <= limit (or >= for `atLeast`). */
  op: "<=" | ">=" | "==";
  limit: number;
  pass: boolean;
  /** Why this limit (shown in reports). */
  why?: string;
}

export interface Metric {
  /** Unique and stable across runs: `<suite>/<scenario>[/<detail>][/<family>@<n>]`. */
  id: string;
  suite: string;
  scenario: string;
  kind: MetricKind;
  unit: string;
  value: number;
  /** Time metrics: value ÷ the environment's calibration ms (set when parts are merged). */
  normalized?: number;
  /** "node" (Vitest) or "browser" (Playwright): which calibration normalises it; "build" (sizes) has none. */
  env: "node" | "browser" | "build";
  stats?: Stats;
  workload?: WorkloadInfo;
  gate?: Gate;
  note?: string;
}

export interface Part {
  schema: typeof SCHEMA;
  suite: string;
  env: "node" | "browser" | "build";
  calibrationMs: number;
  metrics: Metric[];
  /** Extra facts the suite knows (renderer kind, browser version...). */
  info?: Record<string, unknown>;
}

/** Where results go: BENCH_OUT, else tests/.output/bench. */
export const outDir = () => resolve(process.env.BENCH_OUT ?? join("tests", ".output", "bench"));

/**
 * Writes a suite's part file. One per process: Playwright starts a new worker after a failed test, and each worker
 * writes what it measured, so the file name carries the process id (the merge reads them all).
 */
export function writePart(part: Omit<Part, "schema">): string {
  const dir = join(outDir(), "parts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${part.env}-${part.suite}-${process.pid}.json`);
  writeFileSync(file, JSON.stringify({ schema: SCHEMA, ...part }, null, 1));
  return file;
}

/** Nearest-rank percentile of sorted values. */
const rank = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];

export function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    median: round(median),
    p90: round(rank(sorted, 90)),
    min: round(sorted[0] ?? NaN),
    max: round(sorted[n - 1] ?? NaN),
    mean: round(mean),
    cov: round(mean ? sd / mean : 0, 4),
  };
}

export const round = (v: number, digits = 3) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : v);

/** Collects one suite's metrics; `write()` once at the end. */
export class Recorder {
  readonly metrics: Metric[] = [];
  readonly info: Record<string, unknown> = {};

  constructor(
    readonly suite: string,
    readonly env: "node" | "browser",
  ) {}

  add(m: Omit<Metric, "suite" | "env">): Metric {
    if (this.metrics.some((x) => x.id === m.id)) throw new Error(`duplicate metric ${m.id}`);
    const metric: Metric = { ...m, suite: this.suite, env: this.env, value: round(m.value) };
    this.metrics.push(metric);
    return metric;
  }

  write(calibrationMs: number): string {
    return writePart({ suite: this.suite, env: this.env, calibrationMs, metrics: this.metrics, info: this.info });
  }
}

/** A gate: records whether `value op limit` holds. The caller still asserts it, so a failing gate fails the run. */
export function gate(op: Gate["op"], value: number, limit: number, why?: string): Gate {
  const pass = op === "<=" ? value <= limit : op === ">=" ? value >= limit : value === limit;
  return { op, limit, pass, ...(why ? { why } : {}) };
}
