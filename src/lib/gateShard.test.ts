import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { options, plan, canStamp } from "../../scripts/gate/logic.mjs";
import { runSteps } from "../../scripts/gate/run.mjs";
import { planShards, shardFiles } from "../../scripts/e2e-shard.mjs";
import { selfHostProfiles } from "../../scripts/e2e-profiles.mjs";
import { collectNative, failureSummary } from "../../scripts/e2e-failures.mjs";
import CheckpointReporter, { pendingReport, writeCheckpoint, readTestReport } from "../../scripts/gate/reporter.mjs";
import type { FullConfig, Suite, TestCase, TestResult } from "@playwright/test/reporter";

const directories: string[] = [];
function fixture() {
  mkdirSync("tests/.output", { recursive: true });
  const root = mkdtempSync(resolve("tests/.output/gate-shard-"));
  directories.push(root);
  mkdirSync(join(root, "tests/e2e"), { recursive: true });
  const seconds = {
    "a.spec.ts": 12,
    "self-host.spec.ts": 8,
    "self-host-locked.spec.ts": 4,
    "d.spec.ts": 2,
    "e.spec.ts": 1,
  };
  for (const file of Object.keys(seconds)) writeFileSync(join(root, "tests/e2e", file), "");
  writeFileSync(join(root, "tests/e2e-timings.json"), JSON.stringify({ seconds }));
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of directories.splice(0))
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it("parses one-based shards and never stamps even a 1/1 shard", () => {
  expect(options(["--shard", "2/6"]).shard).toEqual({ current: 2, total: 6 });
  for (const value of ["1/1", "2/6"]) expect(canStamp(options(["--shard", value]))).toBe(false);
});

it.each([undefined, "", "0/6", "1/0", "7/6", "-1/6", "1.5/6", "1", "1/2/3", "1/2x", "01/6", "1/9007199254740992"])(
  "rejects malformed shard %s",
  (value) => {
    expect(() => options(["--shard", ...(value === undefined ? [] : [value])])).toThrow("--shard");
  },
);

it("rejects shard options that would not select an E2E run", () => {
  for (const args of [["quick"], ["doctor"], ["setup"], ["full", "--only", "unit"]])
    expect(() => options([...args, "--shard", "1/2"])).toThrow("e2e");
});

it("uses the shared duration planner, preserves whole files, and builds only selected self-host profiles", () => {
  const root = fixture();
  expect(planShards(2, root).map((s) => s.seconds)).toEqual([14, 13]);
  const all: string[] = [];
  for (let current = 1; current <= 2; current++) {
    const specs = shardFiles(current, 2, root);
    all.push(...specs);
    const steps = plan(options(["--only", "e2e", "--shard", `${current}/2`]), [], root);
    const browser = steps.flat().filter((step) => step.args.includes("playwright"));
    expect(browser).toHaveLength(1);
    expect(browser[0].args).toEqual(["exec", "playwright", "test", ...specs, "--retries=0", "--forbid-only"]);
    const profiles = selfHostProfiles(specs);
    expect(steps[0].map((s) => s.name)).toEqual(["e2e-build", "preview-build", ...profiles.map((p) => `${p}-build`)]);
    expect(browser[0].env.E2E_SELF_HOST).toBe(profiles.join(","));
  }
  expect(new Set(all).size).toBe(5);
  expect(all).toHaveLength(5);
  expect(() => shardFiles(1, 6, root)).toThrow("fewer shards");
  expect(() => shardFiles(0, 2, root)).toThrow();
  expect(() => planShards(0, root)).toThrow();
  const cli = spawnSync(process.execPath, [resolve("scripts/e2e-shard.mjs"), "1", "2"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(cli.status, cli.stderr).toBe(0);
  expect(cli.stdout.trim().split(" ")).toEqual(shardFiles(1, 2, root));
});

it("enables internal and locked independently, including for explicit quick specs", () => {
  expect(selfHostProfiles(["self-host.spec.ts"])).toEqual(["internal", "locked"]);
  expect(selfHostProfiles(["tests/e2e/.*spec.ts"])).toEqual(["internal", "locked"]);
  for (const [spec, name] of [
    ["self-host.spec.ts", "internal"],
    ["self-host-locked.spec.ts", "locked"],
  ]) {
    const steps = plan(options(["quick", `tests/e2e/${spec}`, "--only", "e2e"])).flat();
    expect(steps.filter((s) => s.name.endsWith("-build")).map((s) => s.name)).toEqual([
      "e2e-build",
      "preview-build",
      `${name}-build`,
    ]);
    expect(steps.at(-1)?.env.E2E_SELF_HOST).toBe(name);
  }
});

it("persists completed test counts and errors before a reporter process is killed", async () => {
  const root = fixture();
  const file = join(root, "checkpoint.json");
  const module = pathToFileURL(resolve("scripts/gate/reporter.mjs")).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import Reporter from ${JSON.stringify(module)};
    const reporter = new Reporter();
    const test = (id, outcome) => ({ id, title: id, titlePath: () => ['', 'chromium', 'smoke.spec.ts', 'suite', id],
      location: { file: process.cwd() + '/smoke.spec.ts', line: 7 },
      parent: { project: () => ({ name: 'chromium' }) }, outcome: () => outcome });
    reporter.onBegin({ rootDir: process.cwd() }, { allTests: () =>
      ['passes', 'fails', 'running', 'queued'].map(id => test(id, 'expected')) });
    reporter.onTestEnd(test('passes', 'expected'), { status: 'passed', duration: 1 });
    reporter.onTestEnd(test('fails', 'unexpected'), { status: 'failed', duration: 1, error: { message: 'test error' } });
    reporter.onTestBegin?.(test('running', 'expected'));
    reporter.onError({ message: 'runner error' });
    process.send('checkpoint');
    setInterval(() => {}, 1000);
  `,
    ],
    { env: { ...process.env, GATE_CHECKPOINT: file }, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  try {
    await once(child, "message");
    const exited = once(child, "exit");
    child.kill();
    await exited;
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report).toMatchObject({
      interrupted: true,
      expectedTests: 4,
      completed: 2,
      stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
    });
    const summary = failureSummary([{ label: "native-e2e-windows-latest-1", report }]);
    expect(summary).toContain("2 of 4 tests completed");
    expect(summary).toContain("1 passed, 1 failed");
    expect(summary).toContain("failed 1 of 1: test error");
    expect(summary).toContain("Runner error: runner error");
    expect(summary).toContain("smoke.spec.ts:7 › suite › running [chromium]: unfinished (running)");
    expect(summary).toContain("smoke.spec.ts:7 › suite › queued [chromium]: unfinished (not started)");
    expect(summary).not.toContain("running [chromium]`: failed");
  } finally {
    child.kill();
  }
});

it("retains partial counts in the gate summary when the final JSON is absent", async () => {
  const root = fixture();
  const directory = join(root, "reports");
  mkdirSync(directory);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const report = {
    ...pendingReport(),
    completed: 1,
    expectedTests: 2,
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  };
  const result = await runSteps(
    root,
    options(["--only", "e2e", "--shard", "1/2", "--ports", "6480"]),
    [],
    directory,
    {},
    async (args, { env }) => {
      if (!args.includes("playwright")) {
        expect(JSON.parse(readFileSync(join(directory, "e1/checkpoint.json"), "utf8")).interrupted).toBe(true);
        return { code: 0, text: "" };
      }
      expect(env.E2E_SELF_HOST).toBe("");
      expect(args).toContain("--reporter=line,html,json,./scripts/gate/reporter.mjs");
      writeCheckpoint(env.GATE_CHECKPOINT, report);
      return { code: 130, text: "interrupted" };
    },
  );
  expect(result.failures).toBe(1);
  expect(result.reports[0]).toMatchObject({ passed: 1, failed: 0 });
});

it("retains unfinished identities beside a final partial JSON and clears them when every case completes", () => {
  const root = fixture();
  const file = join(root, "checkpoint.json");
  vi.stubEnv("GATE_CHECKPOINT", file);
  const reporter = new CheckpointReporter();
  const test = {
    id: "case-1",
    title: "remaining case",
    titlePath: () => ["", "chromium", "smoke.spec.ts", "remaining case"],
    location: { file: join(root, "smoke.spec.ts"), line: 7 },
    parent: { project: () => ({ name: "chromium" }) },
    outcome: () => "expected",
  } as unknown as TestCase;
  reporter.onBegin({ rootDir: root } as FullConfig, { allTests: () => [test] } as Suite);
  writeFileSync(join(root, "results.json"), JSON.stringify({ stats: pendingReport().stats }));
  const summary = () => failureSummary([{ label: "native", report: readTestReport(root) }]);
  expect(summary()).toContain("remaining case [chromium]: unfinished (not started)");
  reporter.onTestBegin(test);
  reporter.onEnd({ status: "failed" } as Parameters<CheckpointReporter["onEnd"]>[0]);
  expect(summary()).toContain("remaining case [chromium]: unfinished (running)");
  reporter.onTestEnd(test, { status: "passed", duration: 1 } as TestResult);
  reporter.onEnd({ status: "passed" } as Parameters<CheckpointReporter["onEnd"]>[0]);
  expect(summary()).not.toContain("unfinished");
  expect(summary()).not.toContain("Interrupted");
});

it("collects final native shard counts once, falls back on truncated JSON, and reports unit failures", () => {
  const root = fixture();
  const directory = join(root, "g");
  const step = join(directory, "r1/e1");
  mkdirSync(step, { recursive: true });
  writeCheckpoint(join(step, "checkpoint.json"), {
    ...pendingReport(),
    completed: 1,
    expectedTests: 2,
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  });
  writeFileSync(join(step, "results.json"), "{truncated");
  expect(collectNative(directory).native).toHaveLength(1);
  expect(failureSummary([{ label: "native-shard", report: collectNative(directory) }])).toContain("Interrupted");
  expect(failureSummary([{ label: "native-shard", report: collectNative(directory) }])).toContain("1 passed");
  writeFileSync(
    join(step, "results.json"),
    JSON.stringify({ stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 } }),
  );
  const interrupted = failureSummary([{ label: "native-shard", report: collectNative(directory) }]);
  expect(interrupted).toContain("3 passed");
  expect(interrupted).toContain("Interrupted");
  writeCheckpoint(join(step, "checkpoint.json"), { ...pendingReport(), interrupted: false });
  const summary = failureSummary([{ label: "native-shard", report: collectNative(directory) }]);
  expect(summary).toContain("3 passed");
  expect(summary).not.toContain("Interrupted");
  mkdirSync(join(directory, "r2/unit"), { recursive: true });
  writeFileSync(
    join(directory, "r2/unit/results.json"),
    JSON.stringify({
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [
        { assertionResults: [{ status: "failed", fullName: "unit regression", failureMessages: ["broken"] }] },
      ],
    }),
  );
  expect(failureSummary([{ label: "native-unit", report: collectNative(directory) }])).toContain(
    "unit regression: broken",
  );
  const missing = join(root, "missing");
  expect(failureSummary([{ label: "native", report: collectNative(missing) }])).toContain("no test counts available");
  const output = join(root, "native-results.json");
  const cli = spawnSync(process.execPath, ["scripts/e2e-failures.mjs", "--collect-native", missing, output], {
    encoding: "utf8",
  });
  expect(cli.status, cli.stderr).toBe(0);
  expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(collectNative(missing));
});

it("Nightly covers each OS's shards exactly once and leaves time to upload reports after a step timeout", () => {
  const { jobs } = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  const native = jobs["native-e2e"];
  expect(native.strategy["fail-fast"]).toBe(false);
  for (const [os, total] of [
    ["windows-latest", 8],
    ["macos-latest", 12],
  ] as const) {
    const entries = native.strategy.matrix.include.filter((entry: { os: string }) => entry.os === os);
    expect(entries.map((entry: { shard: number }) => entry.shard)).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );
    expect(entries.every((entry: { total: number }) => entry.total === total)).toBe(true);
  }
  for (const job of [jobs["native-unit"], native]) {
    const run = job.steps.find(
      (step: { run?: string }) => step.run?.includes("vitest run") || step.run?.startsWith("pnpm gate"),
    );
    expect(run["timeout-minutes"]).toBeLessThan(job["timeout-minutes"]);
    expect(
      job.steps
        .filter((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact"))
        .every((step: { if: string }) => step.if === "always()"),
    ).toBe(true);
  }
  expect(jobs.report.needs).toEqual([
    "e2e-build",
    "e2e",
    "native-unit",
    "native-e2e",
    "properties",
    "engines",
    "canvas-engines",
  ]);
  expect(jobs["native-unit"].strategy.matrix.os).toEqual(["windows-latest", "macos-latest"]);
});

it("Nightly reports an engine-determinism-only failure, with its results", () => {
  const { jobs } = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  const needs: Record<string, string> = {
    e2e: "success",
    "native-unit": "success",
    "native-e2e": "success",
    properties: "success",
    engines: "failure",
  };
  const condition = jobs.report.if.replace(/needs\.([a-z0-9-]+)\.result/g, (_: string, job: string) =>
    JSON.stringify(needs[job]),
  );
  expect(runInNewContext(condition, { always: () => true })).toBe(true);
  needs.engines = "success";
  expect(
    runInNewContext(
      jobs.report.if.replace(/needs\.([a-z0-9-]+)\.result/g, (_: string, job: string) => JSON.stringify(needs[job])),
      { always: () => true },
    ),
  ).toBe(false);
  const steps = jobs.engines.steps as { run?: string; uses?: string; if?: string; with?: Record<string, string> }[];
  expect(steps.some((step) => step.run?.includes("playwright install --with-deps chromium firefox webkit"))).toBe(true);
  expect(steps.find((step) => step.run?.includes("pnpm test:engines"))?.run).toContain("--reporter=list,json");
  const artifact = steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
  expect(artifact?.with).toMatchObject({ name: "nightly-results-engines", path: "tests/.output/engines-results.json" });
  expect(jobs.report.steps.find((step: { run?: string }) => step.run?.includes("e2e-failures.mjs")).run).toContain(
    "results/nightly-results-engines/engines-results.json",
  );
});

it("Nightly reports a property-only failure", () => {
  const { jobs } = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  expect(jobs.report.needs).toContain("properties");
  const needs = { e2e: "success", "native-unit": "success", "native-e2e": "success", properties: "failure" };
  const condition = jobs.report.if.replace(/needs\.([a-z0-9-]+)\.result/g, (_: string, job: keyof typeof needs) =>
    JSON.stringify(needs[job]),
  );
  expect(runInNewContext(condition, { always: () => true })).toBe(true);
  const run = jobs.properties.steps.find((step: { run?: string }) => step.run?.includes("vitest run")).run;
  expect(run).toContain("--reporter=json --outputFile=tests/.output/property-results.json");
  const artifact = jobs.properties.steps.find((step: { uses?: string }) =>
    step.uses?.startsWith("actions/upload-artifact"),
  );
  expect(artifact.if).toBe("always()");
  expect(artifact.with).toMatchObject({
    name: "nightly-results-properties-${{ matrix.shard }}",
    path: "tests/.output/property-results.json",
  });
  expect(
    jobs.report.steps.find(
      (step: { run?: string }) => step.run?.includes("failureSummary") || step.run?.includes("e2e-failures.mjs"),
    ).run,
  ).toContain("results/nightly-results-properties-*/property-results.json");
  const message =
    'Property failed after 8 tests\n{ seed: -673370871, path: "7:2:1", endOnFailure: true }\nCounterexample: [["Escape","Tab"]]';
  const summary = failureSummary([
    {
      label: "Random property tests",
      report: {
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 1,
        numPendingTests: 0,
        testResults: [
          { assertionResults: [{ status: "failed", fullName: "focus property", failureMessages: [message] }] },
        ],
      },
    },
  ]);
  expect(summary).toContain("focus property");
  expect(summary).toContain("**Random property tests** (1 failed)");
  expect(summary).toContain(message);
});
