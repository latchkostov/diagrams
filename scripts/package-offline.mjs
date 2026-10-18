import process from "node:process";
import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { loadEnv, runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    out: { type: "string", default: "offline-output" },
    "frame-ancestors": { type: "string", default: "" },
    base: { type: "string", default: "/" },
  },
});
const shellEnv = { ...process.env };
const { stageOffline, archiveTar, offlineBuildEnv } = (
  await runnerImport(path.join(root, "scripts/offline-package.ts"), { root, configFile: false, logLevel: "error" })
).module;
const env = offlineBuildEnv(shellEnv, loadEnv("production", root, "VITE_"));
const run = (command, args, shell = false) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell });
  if (result.status !== 0) throw new Error(`${command} failed (${result.error?.message ?? result.status})`);
};
run("pnpm", ["build:internal"], process.platform === "win32");
const revision = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" });
if (revision.status !== 0) throw new Error("Cannot identify revision for offline archive");
const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (status.status !== 0) throw new Error("Cannot determine offline source state");
const version = `${JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version}-${revision.stdout.trim()}${status.stdout.trim() ? "-dirty" : ""}`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "live-diagrams-offline-"));
const output = path.resolve(values.out);
fs.mkdirSync(output, { recursive: true });
try {
  const stage = stageOffline(root, scratch, version, {
    frameAncestors: values["frame-ancestors"].split(/[\s,]+/).filter(Boolean),
    base: values.base,
  });
  const archive = path.join(output, `${path.basename(stage)}.tar.gz`);
  // Git's GNU tar on Windows treats a drive-letter archive path as a remote host. Use Windows' bsdtar.
  const tar = archiveTar(process.platform, env);
  run(tar, ["-czf", archive, "-C", scratch, path.basename(stage)]);
  const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
  console.log(`Offline bundle: ${archive} (archive checksum alongside; per-file SHA256SUMS inside)`);
} finally {
  // mkdtemp owns exactly this directory; no user-controlled path is deleted.
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(0);
