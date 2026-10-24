import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";

/** Build an immutable tracked-only archive inside this checkout; never switch or modify a worktree.
 * The PR workflow fetches history so this is the actual merge-base, not a stale committed baseline.
 */
export function bundleBase(out) {
  if (process.env.BENCH_BASELINE_ONLY === "1") return undefined;
  const ref = process.env.BENCH_BASE_REF ?? "origin/master";
  const sha = execFileSync("git", ["merge-base", ref, "HEAD"], { encoding: "utf8" }).trim();
  const dir = path.join(out, "merge-base", sha);
  const resultFile = path.join(dir, "results", "parts", "build-bundle.json");
  if (!fs.existsSync(resultFile)) {
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, "source.tar");
    execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, sha]);
    execFileSync("tar", ["-xf", "source.tar"], { cwd: dir });
    fs.unlinkSync(archive);
    // Resolution uses the same installed, pinned toolchain for both builds.
    const modules = path.join(dir, "node_modules");
    if (!fs.existsSync(modules)) fs.symlinkSync(path.resolve("node_modules"), modules, "junction");
    const result = spawnSync(process.execPath, ["scripts/bench/bundle.mjs"], {
      cwd: dir,
      env: { ...process.env, BENCH_BASELINE_ONLY: "1", BENCH_OUT: path.join(dir, "results") },
      stdio: "inherit",
    });
    // A base that is over budget still supplies valid measurements.
    if (!fs.existsSync(resultFile)) throw new Error(`Merge-base bundle build failed (${result.status})`);
  }
  return { sha, metrics: JSON.parse(fs.readFileSync(resultFile, "utf8")).metrics };
}
