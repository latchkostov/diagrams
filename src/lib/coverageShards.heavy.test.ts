import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import { createTempRun } from "../../scripts/test-temp.mjs";
import { compareCoverage } from "../../scripts/ci/compare-coverage.mjs";

it("merges probed native-copy coverage with the same identities as an unsharded run", () => {
  const run = createTempRun("vitest");
  try {
    mkdirSync(join(run.directory, "src"));
    mkdirSync(join(run.directory, "tests"));
    writeFileSync(
      join(run.directory, "src/probe.ts"),
      `export function parse(x: string) { return x.slice(0).trim(); }
export function maybe(x: string) { return x ? parse(x) : ""; }`,
    );
    writeFileSync(
      join(run.directory, "src/view.tsx"),
      `import React from "react";
export const view = (items: string[]) => <span aria-hidden={items.length || undefined}>{items.map(x => x ? x : undefined)}</span>;`,
    );
    writeFileSync(
      join(run.directory, "tests/a.test.ts"),
      `import { it, expect } from "vitest";
import { parse, maybe } from "../src/probe";
import { view } from "../src/view";
it("direct", () => { expect(parse(" a ")).toBe("a"); expect(maybe("")).toBe(""); expect(view(["a", ""])).toBeDefined(); });`,
    );
    writeFileSync(
      join(run.directory, "tests/b.test.ts"),
      `import { it, expect } from "vitest";
import { maybe } from "../src/probe";
it("indirect", () => { expect(maybe(" b ")).toBe("b"); });`,
    );
    const config = join(run.directory, "config.ts");
    const modulePath = (file: string) => JSON.stringify(resolve(file).replaceAll("\\", "/"));
    writeFileSync(
      config,
      `import app from ${modulePath("vitest.config.ts")};
import { operationProbes } from ${modulePath("scripts/operation-probes.ts")};
export default {
  root: ${JSON.stringify(run.directory.replaceAll("\\", "/"))},
  plugins: [operationProbes()],
  test: { include: ["tests/*.test.ts"], coverage: {
    provider: app.test.coverage.provider, include: ["src/*.{ts,tsx}"], reporter: ["json-summary"]
  } }
};`,
    );
    const invoke = (...args: string[]) => {
      const result = spawnSync(
        process.execPath,
        [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", config, "--coverage", "--maxWorkers=1", ...args],
        {
          encoding: "utf8",
          timeout: 40_000,
          env: { ...process.env, ...run.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
        },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
    };
    for (const shard of [1, 2])
      invoke(
        `--shard=${shard}/2`,
        "--reporter=blob",
        `--outputFile.blob=${join(run.directory, "blobs", `${shard}.json`)}`,
      );
    invoke(
      `--merge-reports=${join(run.directory, "blobs")}`,
      `--coverage.reportsDirectory=${join(run.directory, "merged")}`,
    );
    invoke(`--coverage.reportsDirectory=${join(run.directory, "reference")}`);
    const summary = (dir: string) =>
      JSON.parse(readFileSync(join(run.directory, dir, "coverage-summary.json"), "utf8"));
    expect(summary("reference").total.statements.covered).toBeGreaterThan(0);
    expect(Object.keys(summary("reference")).some((file) => file.endsWith("/src/view.tsx"))).toBe(true);
    expect(compareCoverage(summary("merged"), summary("reference"))).toEqual([]);
  } finally {
    run.dispose({ checkOwned: true });
  }
}, 40_000);
