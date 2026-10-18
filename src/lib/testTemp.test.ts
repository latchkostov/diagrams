import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { afterEach, expect, it } from "vitest";
import { createTempRun, removalOptions } from "../../scripts/test-temp.mjs";
import { runSteps } from "../../scripts/gate/run.mjs";
import { options } from "../../scripts/gate/logic.mjs";

const fixtures: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "temp-regression-"));
  fixtures.push(root);
  const systemTemp = join(root, "system-temp");
  mkdirSync(systemTemp);
  return { root, systemTemp };
}
afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, removalOptions);
});

it("gives concurrent runs distinct repo-drive roots and removes them on teardown", () => {
  const options = fixture();
  const first = createTempRun("vitest", options);
  const second = createTempRun("vitest", options);
  expect(JSON.parse(readFileSync(join(first.directory, "owner.json"), "utf8"))).toEqual({
    namespace: expect.any(String),
    pid: process.pid,
  });
  expect(first.directory).not.toBe(second.directory);
  expect(dirname(first.directory)).toBe(join(options.root, "tests/.output/tmp"));
  for (const key of ["TMP", "TEMP", "TMPDIR"] as const) expect(first.env[key]).toBe(first.directory);
  first.dispose();
  expect(existsSync(first.directory)).toBe(false);
  expect(existsSync(second.directory)).toBe(true);
  second.dispose();
});

it("reaps abandoned same-namespace runs while retaining live, recent and unverifiable owners", () => {
  const options = { ...fixture(), namespace: "current-namespace" };
  const parent = join(options.root, "tests/.output/tmp");
  mkdirSync(parent, { recursive: true });
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const stale = ["vitest-2147483647-1-old", "parity-2147483647-1-old", "gate-2147483647-1-old"];
  const live = `vitest-${process.pid}-1-live`;
  const retained = [
    live,
    "vitest-1-2-recent",
    "vitest-2147483647-1-legacy",
    "parity-2147483647-1-corrupt",
    "unrelated",
  ];
  for (const name of [...stale, ...retained]) {
    mkdirSync(join(parent, name));
    if (stale.includes(name) || name === live || name === "vitest-1-2-recent")
      writeFileSync(
        join(parent, name, "owner.json"),
        JSON.stringify({ namespace: options.namespace, pid: Number(name.split("-")[1]) }),
      );
    if (name.endsWith("-corrupt")) writeFileSync(join(parent, name, "owner.json"), "{");
    if (name !== "vitest-1-2-recent") utimesSync(join(parent, name), old, old);
  }
  const run = createTempRun("vitest", options);
  for (const name of stale) expect(existsSync(join(parent, name))).toBe(false);
  for (const name of retained) expect(existsSync(join(parent, name))).toBe(true);
  run.dispose();
});

it.each(["container-namespace", null])("retains a foreign live run when the local PID namespace is %s", (namespace) => {
  const options = fixture();
  const parent = join(options.root, "tests/.output/tmp");
  const foreign = join(parent, "vitest-2147483647-1-foreign");
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "owner.json"), JSON.stringify({ namespace: "host-namespace", pid: 2147483647 }));
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  utimesSync(foreign, old, old);
  const run = createTempRun("parity", { ...options, namespace });
  expect(existsSync(foreign)).toBe(true);
  run.dispose();
  expect(existsSync(foreign)).toBe(true);
});

it.each(["livediagrams-probe", "parity-probe", "deployment-build-probe"])(
  "ignores foreign system-temp %s folders created during a run",
  (name) => {
    const options = fixture();
    mkdirSync(join(options.systemTemp, "livediagrams-existing"));
    const run = createTempRun("vitest", options);
    mkdirSync(join(options.systemTemp, name));
    expect(() => run.dispose({ checkOwned: true })).not.toThrow();
    expect(existsSync(run.directory)).toBe(false);
    // Concurrent worktrees retain ownership of their own scratch.
    expect(existsSync(join(options.systemTemp, name))).toBe(true);
  },
);

it("exposes missing fixture cleanup before the enclosing run deletes it", () => {
  const run = createTempRun("vitest", fixture());
  mkdirSync(join(run.directory, "livediagrams-skill-probe"));
  expect(() => run.dispose({ checkOwned: true })).toThrow("Test directories missing cleanup");
  expect(existsSync(run.directory)).toBe(false);
});

it("collects a fully filtered-out skill suite without creating a fixture that skips cleanup", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "src/ai/skill/skill.test.ts",
      "-t",
      "^no-tests-match-this-filter$",
      "--maxWorkers=1",
      "--typecheck.enabled=false",
    ],
    { encoding: "utf8", env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" }, timeout: 40_000 },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 40_000);

it("removes a gate's Node scratch even when spawning a step throws", async () => {
  const { root } = fixture();
  const reports = join(root, "reports");
  let temp = "";
  await expect(
    runSteps(root, options(["quick", "--only", "lint"]), [], reports, {}, async (_args, { env }) => {
      temp = env.TEMP;
      writeFileSync(join(temp, "scratch"), "in use");
      throw new Error("spawn failed");
    }),
  ).rejects.toThrow("spawn failed");
  expect(temp).toBeTruthy();
  expect(existsSync(temp)).toBe(false);
});

it.each(["forks", "threads"])(
  "redirects import-time os.tmpdir and child processes in the %s pool",
  (pool) => {
    const { root, systemTemp } = fixture();
    const setup = resolve("src/test/globalSetup.ts");
    const config = join(root, "vitest.config.mjs");
    writeFileSync(
      config,
      `export default { test: { include: ["*.test.mjs"], globalSetup: [${JSON.stringify(setup)}], pool: "${pool}", maxWorkers: 2 } };`,
    );
    for (const name of ["one", "two"]) {
      writeFileSync(
        join(root, `${name}.test.mjs`),
        `
      import { afterAll, expect, it } from "vitest";
      import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join, relative } from "node:path";
      import { spawnSync } from "node:child_process";
      const directory = mkdtempSync(join(tmpdir(), "livediagrams-probe-"));
      afterAll(() => rmSync(directory, ${JSON.stringify(removalOptions)}));
      it("inherits the run root before module evaluation", () => {
        expect(relative(process.cwd(), tmpdir()).replaceAll("\\\\", "/")).toMatch(/^tests\\/\\.output\\/tmp\\/vitest-/);
        expect(process.env.TMP).toBe(tmpdir());
        expect(process.env.TEMP).toBe(tmpdir());
        expect(process.env.TMPDIR).toBe(tmpdir());
        const child = spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:os').tmpdir())"], { encoding: "utf8" });
        expect(child.status).toBe(0);
        expect(child.stdout).toBe(tmpdir());
        writeFileSync("${name}.json", JSON.stringify({ directory: tmpdir(), worker: process.env.VITEST_WORKER_ID }));
      });
    `,
      );
    }
    const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", config], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TMP: systemTemp,
        TEMP: systemTemp,
        TMPDIR: systemTemp,
        LIVEDIAGRAMS_SYSTEM_TEMP: systemTemp,
      },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const records = ["one", "two"].map(
      (name) => JSON.parse(readFileSync(join(root, `${name}.json`), "utf8")) as { directory: string; worker: string },
    );
    expect(records[0].directory).toBe(records[1].directory);
    expect(records[0].worker).not.toBe(records[1].worker);
    expect(existsSync(records[0].directory)).toBe(false);
    expect(readdirSync(systemTemp)).toEqual([]);
  },
  40_000,
);
