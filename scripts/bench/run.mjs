// Runs the benchmark suite (docs/BENCHMARKS.md) and writes results.json and summary.md.
//
//   pnpm bench                       everything, full mode (about 45 minutes on a fast machine)
//   pnpm bench:gates                 the gates only: growth ratios, counts, budgets (a few minutes)
//   pnpm bench:node | bench:ui | bench:bundle | bench:sim
//   pnpm bench:prepare               only materialise the workloads (before running a browser spec by hand)
//   node scripts/bench/run.mjs [--mode full|gates|quick] [--only workloads,node,ui,bundle] [--node sim,checks] [--ui live,load]
//                              [--label name] [--out dir] [--no-build] [--keep] [--grep pattern]
//
// --grep passes a title pattern to Playwright: only the browser benchmarks it matches run (e.g. "live pipeline@5000").
//
// Steps: build the benchmark builds (scripts/bench/build.mjs), materialise the workloads, the Node suites (Vitest,
// tests/bench/node), the browser suites (Playwright, tests/bench/ui, on ports 6210 and 6211), the shipped bundle's
// composition (scripts/bench/bundle.mjs), then merge every part file. Exits 1 when a suite failed or a gate didn't
// hold; the results are written either way.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { merge, OUT } from "./lib.mjs";
import { summary } from "./report.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (i++, next) : true;
}
const mode = args.mode ?? process.env.BENCH_MODE ?? "full";
if (!["full", "gates", "quick"].includes(mode)) throw new Error(`--mode must be full, gates or quick, not ${mode}`);
const only = new Set(String(args.only ?? "node,ui,bundle").split(","));
const out = path.resolve(args.out ?? OUT);
const list = (v) => (typeof v === "string" ? v.split(",") : []);
const nodeSuites = list(args.node);
/** The browser specs that hold gates; the others only report (they skip themselves in gates mode too). */
const GATING_SPECS = ["renders", "memory", "live"];
const uiSpecs = list(args.ui).length ? list(args.ui) : mode === "gates" ? GATING_SPECS : [];
const env = { ...process.env, BENCH_MODE: mode, BENCH_OUT: out };

/** Runs a command, streaming its output; returns whether it succeeded. */
function run(title, cmd, cmdArgs) {
  console.log(`\n▸ ${title}`);
  const started = Date.now();
  // Node scripts run on this Node, no shell. pnpm needs a shell on Windows (it's a .cmd), so each argument is quoted
  // there: a path with spaces stays one argument, and nothing in one is read as a command.
  const win = process.platform === "win32" && cmd !== "node";
  const quote = (a) => (/^[\w./:=@,-]+$/.test(a) ? a : `"${a.replaceAll('"', '\\"')}"`);
  const r =
    cmd === "node"
      ? spawnSync(process.execPath, cmdArgs, { stdio: "inherit", env })
      : spawnSync(cmd, win ? cmdArgs.map(quote) : cmdArgs, { stdio: "inherit", env, shell: win });
  console.log(
    `  ${title}: ${r.status === 0 ? "ok" : `failed (${r.status})`} in ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
  return r.status === 0;
}

const failures = [];
const step = (title, cmd, cmdArgs) => {
  if (!run(title, cmd, cmdArgs)) failures.push(title);
};

// A fresh set of parts (the workloads and builds stay: the workloads are keyed by their generators' hash), unless
// --keep adds this run's suites to the last run's (a long run split in two).
if (!args.keep) {
  fs.rmSync(path.join(out, "parts"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "profiles"), { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });

/**
 * With --keep, a suite run again replaces its earlier part files (named by process id, so directory order says nothing
 * about which is newer): before each step, drop the parts of the suites it's about to write.
 */
function dropParts(prefixes) {
  const dir = path.join(out, "parts");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (prefixes.some((p) => f.startsWith(p))) fs.rmSync(path.join(dir, f));
}
const nodeFiles = (list) =>
  list.length
    ? list
    : fs
        .readdirSync("tests/bench/node")
        .filter((f) => f.endsWith(".bench.ts") && f !== "workloads.bench.ts")
        .map((f) => f.slice(0, -".bench.ts".length));
const uiFiles = (list) =>
  list.length
    ? list
    : fs
        .readdirSync("tests/bench/ui")
        .filter((f) => f.endsWith(".bench.ts"))
        .map((f) => f.slice(0, -".bench.ts".length));

const needsBuild = only.has("ui") || (only.has("node") && (!nodeSuites.length || nodeSuites.includes("exports")));
if (needsBuild && !args["no-build"]) step("build", "node", ["scripts/bench/build.mjs", out]);

const vitest = (files) => ["exec", "vitest", "run", "--config", "tests/bench/vitest.config.ts", ...files];
if (only.has("node") || only.has("ui") || only.has("workloads")) {
  dropParts(["node-workloads-"]);
  step("workloads", "pnpm", vitest(["tests/bench/node/workloads.bench.ts"]));
}
if (only.has("node")) {
  const suites = nodeFiles(nodeSuites);
  dropParts(suites.map((s) => `node-${s}-`));
  step("node suites", "pnpm", vitest(suites.map((s) => `tests/bench/node/${s}.bench.ts`)));
}
if (only.has("ui")) dropParts(uiFiles(uiSpecs).map((s) => `browser-${s}-`));
if (only.has("ui"))
  step("browser suites", "pnpm", [
    "exec",
    "playwright",
    "test",
    "--config",
    "tests/bench/playwright.config.ts",
    ...uiSpecs.map((s) => `${s}.bench.ts`),
    ...(typeof args.grep === "string" ? ["--grep", args.grep] : []),
  ]);
if (only.has("bundle")) step("bundle", "node", ["scripts/bench/bundle.mjs"]);

const results = merge(path.join(out, "parts"), {
  mode,
  label: args.label ?? null,
  cpuThrottle: Number(process.env.BENCH_CPU ?? 2),
  steps: [...only],
  failedSteps: failures,
});
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(out, "summary.md"), summary(results));
const { failed, total } = results.meta.gates;
console.log(
  `\nResults: ${path.relative(process.cwd(), path.join(out, "results.json"))} (${results.metrics.length} metrics)`,
);
console.log(`Summary: ${path.relative(process.cwd(), path.join(out, "summary.md"))}`);
console.log(`Gates: ${total - failed.length} of ${total} pass${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
if (failures.length) console.log(`Failed steps: ${failures.join(", ")}`);
process.exitCode = failures.length || failed.length ? 1 : 0;
