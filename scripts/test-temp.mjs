import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

export const removalOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
const day = 24 * 60 * 60 * 1000;
const runName = /^(vitest|parity|gate)-(\d+)-\d+-[\w-]+$/;
const testName = /^(livediagrams-|parity-|deployment-build-)/;

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

/** Each owner deletes only its own scratch tree. Killed runs are reaped after a day. */
export function createTempRun(
  kind,
  { root = process.cwd(), systemTemp = process.env.LIVEDIAGRAMS_SYSTEM_TEMP || tmpdir(), now = Date.now() } = {},
) {
  const parent = resolve(root, "tests/.output/tmp");
  mkdirSync(parent, { recursive: true });
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    const match = runName.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const directory = join(parent, entry.name);
    try {
      if (now - statSync(directory).mtimeMs > day && !running(Number(match[2]))) rmSync(directory, removalOptions);
    } catch (error) {
      // Another runner may have finished or reaped the same stale tree after our listing.
      if (error.code !== "ENOENT") throw error;
    }
  }
  const before = new Set(testDirectories(systemTemp));
  const directory = mkdtempSync(join(parent, `${kind}-${process.pid}-${now}-`));
  const env = { TMP: directory, TEMP: directory, TMPDIR: directory, LIVEDIAGRAMS_SYSTEM_TEMP: systemTemp };
  return {
    directory,
    env,
    dispose({ checkOwned = false } = {}) {
      try {
        const leaked = testDirectories(systemTemp).filter((name) => !before.has(name));
        if (leaked.length) throw new Error(`New test directories in system temp: ${leaked.join(", ")}`);
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
