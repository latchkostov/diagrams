import os from "node:os";
import console from "node:console";
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync, cpSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pnpm } from "./commands.mjs";
import { plan, playwrightCounts, workerCount } from "./logic.mjs";
import { pendingReport, writeCheckpoint, readTestReport } from "./reporter.mjs";

// Linux reports are copied home after the run. Keep Chrome's high-churn profiles
// outside that copy tree, in their own native volume at this repository path.
export const browserTemp = (root, directory, container = false) =>
  resolve(container ? join(root, "tests/.output/tmp") : join(directory, "tmp"));

export function prepareBrowserTemp(root, directory, container = false, remove = rmSync) {
  const temp = browserTemp(root, directory, container);
  const within = relative(root, temp);
  if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error("Browser temporary files must stay inside the repository");
  mkdirSync(temp, { recursive: true });
  // The Linux directory is a mount point: clean its contents without unlinking it.
  for (const entry of readdirSync(temp)) remove(join(temp, entry), { recursive: true, force: true });
  return temp;
}

export async function runSteps(root, config, changed, directory, extraEnv = {}, execute = pnpm) {
  const started = performance.now();
  const rows = [];
  const reports = [];
  const workers = config.workers ?? workerCount(os.availableParallelism(), os.totalmem());
  const temp = prepareBrowserTemp(root, directory, extraEnv.GATE_CONTAINER === "1");
  const env = {
    CI: "true",
    E2E_TARGET: "build",
    E2E_GATE: "1",
    E2E_PREBUILT: "1",
    E2E_CHROMIUM_ONLY: "",
    E2E_SKIP_PREVIEW: "",
    E2E_SELF_HOST: "internal,locked",
    VITE_E2E: "",
    VITE_DISABLE_SHARE_LINKS: "",
    VITE_DISABLE_LINK_OPEN: "",
    VITE_DISABLE_AI_TOOLS: "",
    VITE_DISABLE_ONDEVICE: "",
    VITE_PRIVATE_BY_DEFAULT: "",
    VITE_BRAND_NAME: "",
    VITE_LOCALES: "",
    E2E_PORT: String(config.ports),
    E2E_DEV_PORT: String(config.ports + 1),
    E2E_PREVIEW_PORT: String(config.ports + 2),
    E2E_INTERNAL_PORT: String(config.ports + 3),
    E2E_LOCKED_PORT: String(config.ports + 4),
    PARITY_PORT: String(config.ports),
    PLAYWRIGHT_HTML_OPEN: "never",
    // Parity's Linux container must not use the host's temp path.
    ...extraEnv,
  };
  const groups = plan(config, changed, root);
  // Seed before builds: an interruption there still leaves an uploadable marker.
  for (const step of groups.flat().filter((step) => /^e2e-\d+$/.test(step.name))) {
    const stepDir = join(directory, `e${step.name.slice(4)}`);
    mkdirSync(stepDir, { recursive: true });
    writeCheckpoint(join(stepDir, "checkpoint.json"), pendingReport());
  }
  if (config.shard) console.log(`Shard ${config.shard.current}/${config.shard.total} (whole spec files)`);
  for (const group of groups) {
    const buildsFailed = rows.some((r) => r.name.endsWith("-build") && !r.ok);
    const results = await Promise.all(
      group.map(async (step) => {
        const start = performance.now();
        const e2e = step.name.startsWith("e2e-") && !step.name.endsWith("build");
        const stepDir = join(directory, e2e ? `e${step.name.slice(4)}` : step.name);
        mkdirSync(stepDir, { recursive: true });
        const args = [...step.args];
        const stepEnv = { ...env, ...step.env };
        if (e2e) {
          Object.assign(stepEnv, { TMPDIR: temp, TMP: temp, TEMP: temp });
          if (buildsFailed) return { name: step.name, ok: false, seconds: 0, detail: "Skipped: a fresh build failed" };
          args.push(
            `--workers=${workers}`,
            `--output=${join(stepDir, "results")}`,
            "--reporter=line,html,json,./scripts/gate/reporter.mjs",
          );
          stepEnv.GATE_CHECKPOINT = resolve(stepDir, "checkpoint.json");
          stepEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = resolve(stepDir, "results.json");
          stepEnv.PLAYWRIGHT_HTML_OUTPUT_DIR = resolve(stepDir, "report");
        }
        if (step.name === "unit")
          args.push("--reporter=default", "--reporter=json", `--outputFile=${join(stepDir, "results.json")}`);
        console.log(`== ${step.name} ${e2e ? `(${workers} workers)` : ""}`);
        if (e2e)
          console.log(
            `Spec files: ${step.args.slice(3, -2).join(" ") || "all"}; self-host: ${stepEnv.E2E_SELF_HOST || "none"}`,
          );
        const result = await execute(args, { cwd: root, env: stepEnv, log: join(stepDir, "step.log") });
        let ok = result.code === 0;
        let counts;
        try {
          if (e2e) {
            const report = readTestReport(stepDir);
            if (report.interrupted)
              console.error(`Interrupted: ${step.name}; retaining ${report.completed} completed tests`);
            ok &&= !report.interrupted;
            counts = playwrightCounts(report);
            reports.push({ name: step.name, ...counts });
            ok &&= counts.failed === 0 && counts.flaky === 0 && counts.errors === 0;
            for (const [project, c] of Object.entries(counts.projects))
              console.log(`  ${project}: ${JSON.stringify(c)}`);
          } else if (step.name === "unit") {
            const report = JSON.parse(readFileSync(join(stepDir, "results.json"), "utf8"));
            counts = { passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests };
            ok &&= report.success && (config.command === "quick" || counts.passed > 0) && counts.failed === 0;
          } else if (step.name === "parity") {
            for (const name of ["parity", "parity-results"])
              if (existsSync(join(root, "tests/.output", name)))
                cpSync(join(root, "tests/.output", name), join(stepDir, name), { recursive: true });
            const summary = /Parity: (\d+) goldens, (\d+) changed, (\d+) added, (\d+) missing, (\d+) stale/.exec(
              result.text,
            );
            if (!summary) throw new Error("Missing parity summary");
            counts = {
              goldens: Number(summary[1]),
              changed: Number(summary[2]),
              added: Number(summary[3]),
              missing: Number(summary[4]),
              stale: Number(summary[5]),
            };
            ok &&= summary.slice(2).every((n) => Number(n) === 0);
          }
        } catch (error) {
          ok = false;
          console.error(error.message);
        }
        const seconds = (performance.now() - start) / 1000;
        console.log(
          `${ok ? "PASS" : "FAIL"}: ${step.name} (${seconds.toFixed(1)}s)${counts ? ` ${JSON.stringify(counts)}` : ""}`,
        );
        if (!ok) console.error(result.text.slice(-8000));
        return { name: step.name, ok, seconds, counts };
      }),
    );
    rows.push(...results);
  }
  const summary = {
    rows,
    reports,
    failures: rows.filter((r) => !r.ok).length,
    workers,
    seconds: (performance.now() - started) / 1000,
  };
  writeFileSync(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

export function printSummary(sha, summary) {
  console.log("\nStep                      Seconds  Result");
  for (const row of summary.rows)
    console.log(`${row.name.padEnd(25)} ${row.seconds.toFixed(1).padStart(7)}  ${row.ok ? "PASS" : "FAIL"}`);
  console.log(`Wall time: ${(summary.totalSeconds ?? summary.seconds).toFixed(1)}s`);
  const units = summary.rows.find((r) => r.name === "unit")?.counts;
  const parity = summary.rows.find((r) => r.name === "parity")?.counts;
  const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const report of summary.reports) for (const key of Object.keys(totals)) totals[key] += report[key];
  const line = `SUMMARY: ${sha} | unit=${JSON.stringify(units ?? "not run")} parity=${JSON.stringify(parity ?? "not run")} e2e=${JSON.stringify(totals)} gate_failures=${summary.failures}`;
  console.log(line);
  return line;
}
