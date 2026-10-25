import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pnpmCommand } from "../gate/commands.mjs";

function archive(sha, dir, root) {
  fs.mkdirSync(dir, { recursive: true });
  const tar = path.join(dir, "source.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${tar}`, sha], { cwd: root });
  execFileSync("tar", ["-xf", "source.tar"], { cwd: dir });
  fs.unlinkSync(tar);
}

/** Publish only complete frozen installs. A cache hit is never reinstalled or mutated by pnpm. */
function dependencies(out, sha, dir, root) {
  const lock = fs.readFileSync(path.join(dir, "pnpm-lock.yaml"));
  // The common PR path has exactly the same resolutions: no extra install or cache copy.
  if (lock.equals(fs.readFileSync(path.join(root, "pnpm-lock.yaml")))) return path.join(root, "node_modules");
  const hash = createHash("sha256").update(lock).digest("hex");
  const cacheRoot = path.join(out, "dependencies", `${process.platform}-${process.arch}-${process.versions.node}`);
  const cache = path.join(cacheRoot, hash);
  if (!fs.existsSync(path.join(cache, ".complete"))) {
    fs.mkdirSync(cacheRoot, { recursive: true });
    const staging = fs.mkdtempSync(path.join(cacheRoot, `${hash}-`));
    let published = false;
    try {
      archive(sha, staging, root);
      const [bin, args] = pnpmCommand(["install", "--frozen-lockfile"]);
      const result = spawnSync(bin, args, { cwd: staging, stdio: "inherit", windowsHide: true });
      if (result.error || result.status !== 0)
        throw new Error(`Merge-base dependency install failed (${result.error ?? result.status})`);
      fs.writeFileSync(path.join(staging, ".complete"), hash);
      // pnpm's Windows junctions refer to the install's absolute path: never move the installed tree.
      // Publish a directory link atomically, retaining the original path for all internal links.
      try {
        fs.symlinkSync(staging, cache, "junction");
        published = true;
      } catch (error) {
        if (!fs.existsSync(path.join(cache, ".complete"))) throw error;
      }
    } finally {
      if (!published) fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  return path.join(cache, "node_modules");
}

/** Build an immutable tracked-only archive inside this checkout; never switch or modify a worktree.
 * The PR workflow fetches history so this is the actual merge-base, not a stale committed baseline.
 */
export function bundleBase(out, root = process.cwd()) {
  if (process.env.BENCH_BASELINE_ONLY === "1") return undefined;
  const ref = process.env.BENCH_BASE_REF ?? "origin/master";
  out = path.resolve(out);
  const sha = execFileSync("git", ["merge-base", ref, "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  // Do not reuse measurements produced by the former HEAD-dependency baseline.
  const dir = path.join(out, "merge-base-own-deps", sha);
  const resultFile = path.join(dir, "results", "parts", "build-bundle.json");
  if (!fs.existsSync(resultFile)) {
    archive(sha, dir, root);
    const modules = path.join(dir, "node_modules");
    if (!fs.existsSync(modules)) fs.symlinkSync(dependencies(out, sha, dir, root), modules, "junction");
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
