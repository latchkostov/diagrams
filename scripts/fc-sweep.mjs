#!/usr/bin/env node
import { randomInt } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";

// node scripts/fc-sweep.mjs [--count 100] [--multiplier 5] [--heavy-count 10]
//   [--heavy-multiplier 20] [--jobs 2] [--seed -2104931721 --seed 607376523] [files...]
// Fresh seeds are distinct across both tiers. Explicit seeds are additional runs
// at the ordinary multiplier; replay one with --count 0 --heavy-count 0 --seed N.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = { count: 100, multiplier: 5, "heavy-count": 10, "heavy-multiplier": 20, jobs: 2 };
const seeds = [];
const files = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) {
    files.push(arg);
    continue;
  }
  const key = arg.slice(2);
  const raw = process.argv[++i];
  const value = Number(raw);
  if (raw === undefined || !/^-?\d+$/.test(raw) || !Number.isSafeInteger(value))
    throw new Error(`${arg} requires an integer`);
  if (key === "seed") {
    if (value < -2147483648 || value > 2147483647) throw new Error("--seed requires a signed 32-bit integer");
    seeds.push(value);
  } else {
    if (!Object.hasOwn(options, key)) throw new Error(`Unknown option ${arg}`);
    if (value < (key.endsWith("count") ? 0 : 1)) throw new Error(`Invalid ${arg}: ${value}`);
    options[key] = value;
  }
}
if (!files.length) {
  files.push(
    ...execFileSync("git", ["ls-files", "--", "*.commands.test.ts"], { cwd: root, encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean),
    "src/sim/waits.review.test.ts",
    "src/sim/waits.sampling.test.ts",
  );
}
const used = new Set(seeds);
function fresh() {
  let seed;
  do seed = randomInt(-2147483648, 2147483648);
  while (used.has(seed));
  used.add(seed);
  return seed;
}
const runs = [
  ...Array.from({ length: options.count }, () => ({ seed: fresh(), multiplier: options.multiplier })),
  ...Array.from({ length: options["heavy-count"] }, () => ({ seed: fresh(), multiplier: options["heavy-multiplier"] })),
  ...seeds.map((seed) => ({ seed, multiplier: options.multiplier })),
];
if (!runs.length) throw new Error("Select at least one seed");
const report = join(root, "tests/.output/fc-sweep", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(report, { recursive: true });
const started = performance.now();
const results = [];
let next = 0;
let failed = false;
function save() {
  writeFileSync(
    join(report, "results.json"),
    JSON.stringify(
      { node: process.version, files, runs, results, seconds: (performance.now() - started) / 1000 },
      null,
      2,
    ) + "\n",
  );
}
save();
console.log(`Sweeping ${runs.length} seeds on ${process.version}, ${options.jobs} jobs; files: ${files.join(", ")}`);
console.log(`Reports: ${report}`);
async function worker() {
  while (!failed && next < runs.length) {
    const index = next++;
    const run = runs[index];
    const at = performance.now();
    const env = { ...process.env, FC_SEED: String(run.seed), FC_RUN_MULTIPLIER: String(run.multiplier) };
    delete env.FC_PATH;
    let output = "";
    const child = spawn(
      process.execPath,
      [join(root, "node_modules/vitest/vitest.mjs"), "run", ...files, "--maxWorkers", "1"],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const code = await new Promise((accept) => {
      child.on("error", (error) => {
        output += error.stack;
        accept(1);
      });
      child.on("close", (code) => accept(code ?? 1));
    });
    const seconds = (performance.now() - at) / 1000;
    writeFileSync(join(report, `${index + 1}-${run.seed}-x${run.multiplier}.log`), output);
    results.push({ ...run, code, seconds });
    failed ||= code !== 0;
    console.log(
      `${code === 0 ? "PASS" : "FAIL"} ${index + 1}/${runs.length} seed=${run.seed} multiplier=${run.multiplier} (${seconds.toFixed(2)}s)`,
    );
    if (code !== 0) console.error(output); // Preserve fast-check's seed, path and reduced counterexample.
    save();
  }
}
await Promise.all(Array.from({ length: Math.min(options.jobs, runs.length) }, worker));
const seconds = (performance.now() - started) / 1000;
console.log(
  `SUMMARY: ${results.filter((r) => r.code === 0).length} passed, ${results.filter((r) => r.code !== 0).length} failed, ${runs.length - results.length} unrun; ${seconds.toFixed(2)}s`,
);
process.exitCode = failed ? 1 : 0;
