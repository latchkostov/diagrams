import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";

it("runs pinned canvas engines nightly on a production build and reports their failures", () => {
  const { jobs } = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  const job = jobs["canvas-engines"];
  expect(job.env).toMatchObject({ E2E_TARGET: "build", E2E_CHROMIUM_ONLY: "1", E2E_PORT: "6960" });
  expect(job.steps.some((s: { uses?: string }) => s.uses === "./.github/actions/toolchain")).toBe(true);
  expect(
    job.steps.some((s: { run?: string }) => s.run === "pnpm exec playwright install --with-deps firefox webkit"),
  ).toBe(true);
  expect(job.steps.find((s: { run?: string }) => s.run?.includes("canvas.config.ts")).run).toContain(
    "--workers=2 --retries=0 --forbid-only --reporter=list,json",
  );
  const artifact = job.steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/upload-artifact"));
  expect(artifact.if).toBe("always()");
  expect(artifact.with.path).toContain("tests/.output/canvas-engines-results.json");
  expect(jobs.report.needs).toContain("canvas-engines");
  const condition = jobs.report.if.replace(/needs\.([a-z0-9-]+)\.result/g, (_: string, id: string) =>
    JSON.stringify(id === "canvas-engines" ? "failure" : "success"),
  );
  expect(runInNewContext(condition, { always: () => true })).toBe(true);
  expect(jobs.report.steps.find((s: { run?: string }) => s.run?.includes("e2e-failures.mjs")).run).toContain(
    "results/nightly-results-canvas-engines/canvas-engines-results.json",
  );
});

it("self-host CI provisions only the isolated browser while preserving image and chart checks", () => {
  const { jobs } = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const steps = jobs["self-host"].steps as { uses?: string; run?: string }[];
  expect(steps.some((s) => s.uses?.includes("chromium-cache") || s.run?.includes("playwright install"))).toBe(false);
  for (const run of [
    "pnpm self-host:smoke --static-only",
    "pnpm self-host:smoke --server-only",
    "node scripts/self-host-chart-test.mjs",
  ])
    expect(steps.some((s) => s.run === run)).toBe(true);
});
