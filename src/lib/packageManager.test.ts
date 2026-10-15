import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

it("refuses to run with stale dependencies without silently rewriting the lockfile", () => {
  const output = resolve("tests/.output");
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(join(output, "pnpm-policy-"));
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { packageManager: string };
  const pkg = {
    name: "install-policy-probe",
    private: true,
    packageManager: manifest.packageManager,
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
        CI: "true",
      },
    });
  try {
    copyFileSync("pnpm-workspace.yaml", join(fixture, "pnpm-workspace.yaml"));
    mkdirSync(join(fixture, "dependency"));
    writeFileSync(join(fixture, "dependency/package.json"), JSON.stringify({ name: "probe", version: "1.0.0" }));
    writeFileSync(join(fixture, "package.json"), JSON.stringify(pkg));
    const installed = run(["install", "--offline", "--no-frozen-lockfile"]);
    expect(installed.status, installed.stderr + installed.stdout).toBe(0);
    const lock = join(fixture, "pnpm-lock.yaml");
    const before = readFileSync(lock, "utf8");

    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, "another-probe": "file:./dependency" } }),
    );
    const executed = run(["exec", "node", "--version"]);
    expect(executed.status, executed.stderr + executed.stdout).not.toBe(0);
    expect(readFileSync(lock, "utf8")).toBe(before);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
