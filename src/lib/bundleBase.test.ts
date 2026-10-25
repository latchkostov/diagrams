import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { bundleBase } from "../../scripts/bench/bundle-base.mjs";
import { pnpmCommand } from "../../scripts/gate/commands.mjs";

/** Real pnpm resolutions from two local packages: no registry, external checkout or app build. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "diagrams-bundle-base-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const write = (name: string, data: string) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), data);
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  const [bin, prefix] = pnpmCommand([]);
  const install = () =>
    execFileSync(bin, [...prefix, "install", "--frozen-lockfile=false"], { cwd: root, stdio: "pipe" });
  git("init", "-b", "feature");
  git("config", "user.name", "Bundle fixture");
  git("config", "user.email", "bundle@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  write(".gitignore", "node_modules/\n/bench/\n");
  write("pnpm-workspace.yaml", "packages: []\n");
  for (const version of [1, 2]) {
    write(
      `fixtures/v${version}/package.json`,
      JSON.stringify({ name: "resolution-probe", version: `${version}.0.0`, main: "index.cjs" }),
    );
    write(`fixtures/v${version}/index.cjs`, `module.exports = ${version};\n`);
  }
  const manifest = (version: number) =>
    write(
      "package.json",
      JSON.stringify({
        name: "bundle-fixture",
        private: true,
        type: "module",
        dependencies: { "resolution-probe": `file:./fixtures/v${version}` },
      }),
    );
  write(
    "scripts/bench/bundle.mjs",
    `
    import value from "resolution-probe";
    import fs from "node:fs";
    import path from "node:path";
    const parts = path.join(process.env.BENCH_OUT, "parts");
    fs.mkdirSync(parts, {recursive:true});
    fs.writeFileSync(path.join(parts, "build-bundle.json"), JSON.stringify({metrics:[{value}]}));
  `,
  );
  const commit = () => {
    git("add", ".");
    git("commit", "-m", "fixture");
  };
  manifest(1);
  install();
  commit();
  const base = git("rev-parse", "HEAD");
  git("branch", "baseline");
  vi.stubEnv("BENCH_BASE_REF", "baseline");
  vi.stubEnv("BENCH_BASELINE_ONLY", "0");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  return { root, write, manifest, install, commit, base, out: path.join(root, "bench") };
}

it("builds a changed-lock baseline with its own resolutions and reuses its immutable install", () => {
  const f = fixture();
  const baseLock = readFileSync(path.join(f.root, "pnpm-lock.yaml"));
  f.manifest(2);
  f.install();
  f.commit();
  expect(readFileSync(path.join(f.root, "pnpm-lock.yaml")).equals(baseLock)).toBe(false);
  // Count installs without mocking pnpm's resolution: the shim delegates to the installed CLI.
  const [bin, prefix] = pnpmCommand([]);
  const installs = path.join(f.root, "installs.txt");
  f.write(
    "pnpm-probe.cjs",
    `
    const fs = require("node:fs"), {spawnSync} = require("node:child_process");
    fs.appendFileSync(${JSON.stringify(installs)}, "install\\n");
    const result = spawnSync(${JSON.stringify(bin)}, [...${JSON.stringify(prefix)}, ...process.argv.slice(2)], {stdio:"inherit"});
    process.exit(result.status ?? 1);
  `,
  );
  vi.stubEnv("npm_execpath", path.join(f.root, "pnpm-probe.cjs"));
  expect(bundleBase(f.out, f.root)).toEqual({ sha: f.base, metrics: [{ value: 1 }] });
  const dir = path.join(f.out, "merge-base-own-deps", f.base);
  const modules = realpathSync(path.join(dir, "node_modules"));
  expect(modules).not.toBe(realpathSync(path.join(f.root, "node_modules")));
  expect(readFileSync(path.join(modules, "..", "pnpm-lock.yaml")).equals(baseLock)).toBe(true);
  const marker = readFileSync(path.join(modules, "..", ".complete"), "utf8");
  expect(marker).toMatch(/^[a-f0-9]{64}$/);
  // Force a new measurement from a fresh archive, retaining only the dependency cache.
  rmSync(dir, { recursive: true, force: true });
  expect(bundleBase(f.out, f.root)).toEqual({ sha: f.base, metrics: [{ value: 1 }] });
  expect(realpathSync(path.join(dir, "node_modules"))).toBe(modules);
  expect(readFileSync(installs, "utf8")).toBe("install\n");
});

it("does no install when the base and HEAD lockfiles are identical", () => {
  const f = fixture();
  f.write("pnpm-forbidden.cjs", 'throw new Error("Unchanged-lock benchmark must not install");');
  vi.stubEnv("npm_execpath", path.join(f.root, "pnpm-forbidden.cjs"));
  expect(bundleBase(f.out, f.root)).toEqual({ sha: f.base, metrics: [{ value: 1 }] });
  expect(realpathSync(path.join(f.out, "merge-base-own-deps", f.base, "node_modules"))).toBe(
    realpathSync(path.join(f.root, "node_modules")),
  );
});

it("refuses a failed frozen install and retries without publishing incomplete dependencies", () => {
  const f = fixture();
  f.manifest(2);
  f.install();
  f.commit();
  const entry = process.env.npm_execpath;
  f.write("pnpm-failed.cjs", "process.exit(9);");
  vi.stubEnv("npm_execpath", path.join(f.root, "pnpm-failed.cjs"));
  expect(() => bundleBase(f.out, f.root)).toThrow("Merge-base dependency install failed (9)");
  const modules = path.join(f.out, "merge-base-own-deps", f.base, "node_modules");
  expect(existsSync(modules)).toBe(false);
  vi.stubEnv("npm_execpath", entry);
  expect(bundleBase(f.out, f.root)).toEqual({ sha: f.base, metrics: [{ value: 1 }] });
});
