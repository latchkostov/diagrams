import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

export const removalOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
const day = 24 * 60 * 60 * 1000;
const runName = /^(vitest|parity|gate)-(\d+)-\d+-[\w-]+$/;
const testName = /^(livediagrams-|parity-|deployment-build-)/;

function pidNamespace() {
  // A shared checkout can be mounted in containers. A PID is meaningful only in
  // its owning namespace, and namespace inode numbers can repeat across boots.
  if (process.platform === "linux") {
    try {
      return `linux:${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${readlinkSync("/proc/self/ns/pid")}`;
    } catch {
      return null; // No reliable identity: leave cleanup to the owning environment.
    }
  }
  if (process.platform === "win32" || process.platform === "darwin") return `${process.platform}:${hostname()}`;
  return null;
}

function testDirectories(directory) {
  return (
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && testName.test(entry.name))
      // This shared admission directory coordinates other checkouts; it is not test scratch space.
      .filter((entry) => entry.name !== "livediagrams-gate-budget-v1")
      .map((entry) => entry.name)
  );
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

/** Each owner checks only its own scratch tree. Reap dead, same-namespace runs after a day. */
export function createTempRun(
  kind,
  {
    root = process.cwd(),
    systemTemp = process.env.LIVEDIAGRAMS_SYSTEM_TEMP || tmpdir(),
    now = Date.now(),
    namespace = pidNamespace(),
  } = {},
) {
  const parent = resolve(root, "tests/.output/tmp");
  mkdirSync(parent, { recursive: true });
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    const match = runName.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const directory = join(parent, entry.name);
    try {
      if (!namespace || now - statSync(directory).mtimeMs <= day) continue;
      let owner;
      try {
        owner = JSON.parse(readFileSync(join(directory, "owner.json"), "utf8"));
      } catch (error) {
        // Legacy, incomplete or corrupt ownership is not evidence of a dead owner.
        if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
        throw error;
      }
      if (owner?.namespace === namespace && owner.pid === Number(match[2]) && !running(owner.pid))
        rmSync(directory, removalOptions);
    } catch (error) {
      // Another runner may have finished or reaped the same stale tree after our listing.
      if (error.code !== "ENOENT") throw error;
    }
  }
  const directory = mkdtempSync(join(parent, `${kind}-${process.pid}-${now}-`));
  writeFileSync(join(directory, "owner.json"), JSON.stringify({ namespace, pid: process.pid }));
  const env = { TMP: directory, TEMP: directory, TMPDIR: directory, LIVEDIAGRAMS_SYSTEM_TEMP: systemTemp };
  return {
    directory,
    env,
    dispose({ checkOwned = false } = {}) {
      try {
        if (checkOwned) {
          const remaining = testDirectories(directory);
          if (remaining.length) throw new Error(`Test directories missing cleanup: ${remaining.join(", ")}`);
        }
      } finally {
        rmSync(directory, removalOptions);
      }
    },
  };
}
