import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import { createTempRun } from "../../scripts/test-temp.mjs";
import { classifyRun, failedTests } from "../../scripts/ci/known-flakes.mjs";

it("machine JSON preserves an unhandled error beside a known failed assertion", () => {
  const run = createTempRun("vitest");
  try {
    const file = join(run.directory, "probe.test.ts");
    const config = join(run.directory, "config.mjs");
    const output = join(run.directory, "report.json");
    writeFileSync(
      file,
      `import { it } from "vitest";
it("known timeout", () => {
  process.emit("unhandledRejection", new Error("untracked runner defect"), Promise.resolve());
  throw new Error("Test timed out in 30000ms.");
});`,
    );
    writeFileSync(
      config,
      `export default {test:{include:[${JSON.stringify(relative(process.cwd(), file).replaceAll("\\", "/"))}]}};`,
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        config,
        "--maxWorkers=1",
        "--reporter=./scripts/ci/vitest-json.mjs",
        `--outputFile.json=${output}`,
      ],
      {
        encoding: "utf8",
        timeout: 40_000,
        env: { ...process.env, ...run.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const report = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>;
    const parsed = failedTests(report);
    expect(parsed.failed).toHaveLength(1);
    expect(parsed.unknown).toContain("unit runner failure or incomplete report");
    expect(
      classifyRun(
        [{ name: "Heavy tests", conclusion: "failure", steps: [{ name: "Heavy tests", conclusion: "failure" }] }],
        [{ job: "Heavy tests", report }],
        parsed.failed,
      ),
    ).not.toEqual([]);
  } finally {
    run.dispose({ checkOwned: true });
  }
}, 40_000);
