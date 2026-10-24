import { execFileSync } from "node:child_process";
import console from "node:console";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

const normalize = (file) => file.replaceAll("\\", "/").replace(/^.*\/(src|tests)\//, "$1/");

/** Structured reports only. Logs, partial reports and failed setup/build/upload steps never authorize a merge. */
export function failedTests(report) {
  const failed = [];
  const unknown = [];
  if (report.numTotalTests !== undefined) {
    for (const suite of report.testResults ?? []) {
      const assertions = suite.assertionResults ?? [];
      for (const test of assertions)
        if (test.status === "failed")
          failed.push({
            spec: normalize(suite.name),
            title: test.title,
            message: test.failureMessages?.join("\n") ?? "",
          });
      if (suite.status === "failed" && !assertions.some((test) => test.status === "failed"))
        unknown.push(`suite/setup failure: ${normalize(suite.name)}`);
    }
    if (report.numFailedTests > failed.length || report.numRuntimeErrorTestSuites > 0 || report.unhandledErrors?.length)
      unknown.push("unit runner failure or incomplete report");
  } else if (report.suites && report.stats) {
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) {
        const file = normalize(spec.file);
        const specFile =
          /^(src|tests)\//.test(file) || !report.config?.rootDir
            ? file
            : normalize(path.posix.join(report.config.rootDir.replaceAll("\\", "/"), file));
        for (const test of spec.tests ?? [])
          if (test.results?.some((result) => !["passed", "skipped"].includes(result.status)))
            failed.push({
              spec: specFile,
              title: spec.title,
              message: test.results.map((result) => result.error?.message ?? "").join("\n"),
            });
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites) visit(suite);
    if (report.errors?.length || report.interrupted || report.stats.unexpected > failed.length)
      unknown.push("browser runner failure or incomplete report");
  } else unknown.push("unrecognized test report");
  return { failed, unknown };
}

export function classifyRun(jobs, reports, ledger) {
  const unknown = [];
  const red = jobs.filter((job) => !["success", "skipped", "neutral"].includes(job.conclusion));
  for (const job of red) {
    // This final check only propagates the other jobs' results. It has no independent test failures.
    const aggregateStep =
      job.name === "CI" ? "Check results" : job.name === "Types, lint, unit, build" ? "Require every lane" : undefined;
    if (
      aggregateStep &&
      job.conclusion === "failure" &&
      job.steps?.some((step) => step.name === aggregateStep && step.conclusion === "failure") &&
      job.steps.every((step) => step.conclusion !== "failure" || step.name === aggregateStep) &&
      red.some((other) => !["CI", "Types, lint, unit, build"].includes(other.name))
    )
      continue;
    if (job.conclusion !== "failure") {
      unknown.push(`${job.name}: ${job.conclusion ?? "unfinished"}`);
      continue;
    }
    const attached = reports.filter((report) => report.job === job.name);
    const failingSteps = job.steps?.filter((step) => step.conclusion === "failure") ?? [];
    if (
      !failingSteps.length ||
      failingSteps.some(
        (step) => !/^(Unit coverage|Heavy tests|Skill ZIP|Playwright shard(?:.*Playwright)?)$/.test(step.name),
      )
    )
      unknown.push(`${job.name}: failure outside a test step`);
    if (!attached.length) unknown.push(`${job.name}: no structured report`);
    let failures = 0;
    for (const { report } of attached) {
      const result = failedTests(report);
      unknown.push(...result.unknown.map((reason) => `${job.name}: ${reason}`));
      for (const test of result.failed) {
        failures++;
        if (
          !ledger.some(
            (entry) =>
              entry.spec === test.spec &&
              entry.title === test.title &&
              (!entry.failurePattern || new RegExp(entry.failurePattern, "i").test(test.message)),
          )
        )
          unknown.push(`${test.spec} > ${test.title}`);
      }
    }
    if (attached.length && !failures) unknown.push(`${job.name}: no failed test explains the red job`);
  }
  return [...new Set(unknown)];
}

export function checkRun(runId, { gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }) } = {}) {
  if (!/^\d+$/.test(runId)) throw new Error("Usage: known-flakes.mjs <run-id>");
  const repo = process.env.GITHUB_REPOSITORY ?? "latchkostov/diagrams";
  const pages = (endpoint) => JSON.parse(gh("api", "--paginate", "--slurp", endpoint));
  const jobs = pages(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`).flatMap((page) => page.jobs);
  if (!jobs.length) throw new Error("Run has no jobs");
  const artifacts = pages(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`).flatMap(
    (page) => page.artifacts,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "ld-flakes-"));
  const reports = [];
  try {
    for (const artifact of artifacts) {
      const match = /^(?:unit-results-(\d+)|heavy-results|skill-results|e2e-durations-(\d+))$/.exec(artifact.name);
      if (!match || artifact.expired) continue;
      const into = path.join(directory, artifact.name);
      gh("run", "download", runId, "--repo", repo, "--name", artifact.name, "--dir", into);
      const job = match[1]
        ? `Unit coverage ${match[1]}/3`
        : match[2]
          ? `E2E ${match[2]}/6`
          : artifact.name === "heavy-results"
            ? "Heavy tests"
            : "Build, size, skill ZIP";
      for (const file of readdirSync(into))
        if (file.endsWith(".json"))
          reports.push({ job, report: JSON.parse(readFileSync(path.join(into, file), "utf8")) });
    }
    const ledger = JSON.parse(readFileSync(new URL("../../tests/flakes.json", import.meta.url), "utf8"));
    return classifyRun(jobs, reports, ledger);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const unknown = checkRun(process.argv[2] ?? "");
    console.log(unknown.length ? `UNKNOWN: ${unknown.join("; ")}` : "ALL-KNOWN");
    process.exitCode = unknown.length ? 1 : 0;
  } catch (error) {
    console.log(`UNKNOWN: ${error.message}`);
    process.exitCode = 1;
  }
}
