// Shared by the benchmark scripts (docs/BENCHMARKS.md § Output): merging part files into results.json, the
// environment a run records, and the markdown tables of the summary and the comparison.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

export const SCHEMA = "livediagrams-bench/v1";
export const OUT = path.resolve(process.env.BENCH_OUT ?? path.join("tests", ".output", "bench"));

const sh = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

/** What the run ran on: enough to tell two machines, two commits or two settings apart. */
export function environment() {
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: cpus[0]?.model.trim() ?? "unknown",
    cores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 1e9),
    node: process.version,
    ci: !!process.env.CI,
    runner: process.env.RUNNER_NAME ?? process.env.RUNNER_OS ?? null,
    commit: sh("git rev-parse HEAD"),
    branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || sh("git rev-parse --abbrev-ref HEAD"),
    dirty: sh("git status --porcelain --untracked-files=no") !== "",
    playwright: JSON.parse(fs.readFileSync(path.resolve("node_modules/@playwright/test/package.json"), "utf8")).version,
    vite: JSON.parse(fs.readFileSync(path.resolve("node_modules/vite/package.json"), "utf8")).version,
    react: JSON.parse(fs.readFileSync(path.resolve("node_modules/react/package.json"), "utf8")).version,
  };
}

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

/**
 * Merges every part file in `dir` into one results object. Time metrics get `normalized`: the value divided by the
 * calibration its own suite measured (Node: at the suite's start and end; browser: in a page at the same throttle), the
 * reading closest in time to it, so runs on different machines, or on a busy and an idle one, compare.
 */
export function merge(dir, meta) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const parts = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const calibration = {
    node: median(parts.filter((p) => p.env === "node").map((p) => p.calibrationMs)),
    browser: median(parts.filter((p) => p.env === "browser").map((p) => p.calibrationMs)),
  };
  const metrics = new Map();
  const info = {};
  for (const p of parts) {
    info[`${p.env}-${p.suite}`] = { ...(info[`${p.env}-${p.suite}`] ?? {}), ...p.info };
    for (const m of p.metrics) {
      const cal = Number.isFinite(p.calibrationMs) && p.calibrationMs > 0 ? p.calibrationMs : calibration[m.env];
      const out = { ...m };
      if (m.kind === "time" && Number.isFinite(cal) && cal > 0) out.normalized = Number((m.value / cal).toFixed(4));
      metrics.set(m.id, out);
    }
  }
  const all = [...metrics.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const failed = all.filter((m) => m.gate && !m.gate.pass).map((m) => m.id);
  return {
    schema: SCHEMA,
    meta: {
      date: new Date().toISOString(),
      ...meta,
      env: environment(),
      browser: Object.values(info).find((i) => i.browser)?.browser ?? null,
      calibrationMs: calibration,
      gates: { total: all.filter((m) => m.gate).length, failed },
    },
    info,
    metrics: all,
  };
}

// ---------------------------------------------------------------- formatting

export const fmt = (m, v = m.value) => {
  if (!Number.isFinite(v)) return "–";
  if (m.unit === "bytes") return v >= 1e6 ? `${(v / 1e6).toFixed(2)} MB` : `${(v / 1e3).toFixed(1)} kB`;
  if (m.unit === "ms")
    return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v >= 10 ? `${v.toFixed(0)} ms` : `${v.toFixed(2)} ms`;
  if (m.unit === "x") return `${v.toFixed(1)}×`;
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
};

export const table = (head, rows) =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map((h, i) => (i ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

/** `suite/scenario[/detail]` → the id without its workload, and the workload label. */
export function split(m) {
  const w = m.workload ? `${m.workload.family}@${m.workload.n}` : "";
  const base = w && m.id.endsWith(`/${w}`) ? m.id.slice(0, -w.length - 1) : m.id;
  return { base, family: m.workload?.family ?? "", n: m.workload?.n ?? 0 };
}
