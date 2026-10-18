import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";

it("lets packageManager own the pnpm version in CI and nightly actions", () => {
  type Step = { uses?: string; with?: { version?: string } };
  const steps = [
    ".github/workflows/ci.yml",
    ".github/workflows/nightly.yml",
    ".github/actions/e2e/action.yml",
    ".github/actions/toolchain/action.yml",
  ].flatMap((file) => {
    const workflow = parse(readFileSync(file, "utf8")) as {
      jobs?: Record<string, { steps?: Step[] }>;
      runs?: { steps: Step[] };
    };
    return [...Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []), ...(workflow.runs?.steps ?? [])];
  });
  const pnpm = steps.filter((step) => step.uses?.startsWith("pnpm/action-setup@"));
  expect(pnpm.length).toBeGreaterThan(0);
  for (const step of pnpm) expect(step.with?.version).toBeUndefined();
});

function installedFixture() {
  const output = resolve("tests/.output");
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(join(output, "pnpm-policy-"));
  onTestFinished(() => rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const pkg = {
    name: "install-policy-probe",
    private: true,
    dependencies: { probe: "file:./dependency" },
  };
  const run = (args: string[]) =>
    spawnSync(process.env.npm_execpath!, ["--dir", fixture, ...args], {
      encoding: "utf8",
      // pnpm disables verification in its children to avoid recursion. Model a fresh shell instead.
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "pnpm_config_verify_deps_before_run"),
        ),
        // No manager pin in this fixture: exercise the running binary without registry metadata.
        pnpm_config_cache_dir: join(fixture, "cache"),
        pnpm_config_store_dir: join(fixture, "store"),
        CI: "true",
      },
    });
  copyFileSync("pnpm-workspace.yaml", join(fixture, "pnpm-workspace.yaml"));
  mkdirSync(join(fixture, "dependency"));
  writeFileSync(join(fixture, "dependency/package.json"), JSON.stringify({ name: "probe", version: "1.0.0" }));
  writeFileSync(join(fixture, "package.json"), JSON.stringify(pkg));
  const installed = run(["install", "--offline", "--no-frozen-lockfile"]);
  expect(installed.status, installed.stderr + installed.stdout).toBe(0);
  return { fixture, pkg, run };
}

it("allows execution with synchronized dependencies", () => {
  const { run } = installedFixture();
  const executed = run(["exec", "node", "--version"]);
  expect(executed.error).toBeUndefined();
  expect(executed.status, executed.stderr + executed.stdout).toBe(0);
  expect(executed.stdout.trim()).toBe(process.version);
});

it("refuses to run with stale dependencies without silently rewriting the lockfile", () => {
  const { fixture, pkg, run } = installedFixture();
  const lock = join(fixture, "pnpm-lock.yaml");
  const before = readFileSync(lock, "utf8");

  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, "another-probe": "file:./dependency" } }),
  );
  const executed = run(["exec", "node", "--version"]);
  expect(executed.error).toBeUndefined();
  expect(executed.status, executed.stderr + executed.stdout).not.toBe(0);
  expect(executed.stderr + executed.stdout).toContain("ERR_PNPM_VERIFY_DEPS_BEFORE_RUN");
  expect(readFileSync(lock, "utf8")).toBe(before);
});
