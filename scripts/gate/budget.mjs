import { createServer } from "node:net";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { setTimeout, clearTimeout } from "node:timers";
import { acquireLock } from "./host.mjs";
import { admit } from "./logic.mjs";

export const BUSY_EXIT = 75;
export const BUSY_MESSAGE = "busy: push and let CI run the full gate, or retry later";
export class BusyError extends Error {
  constructor() {
    super(BUSY_MESSAGE);
    this.exitCode = BUSY_EXIT;
  }
}

const save = (directory, entry) => {
  const file = join(directory, `${entry.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(entry));
  renameSync(`${file}.tmp`, file);
};

/** Sidecars describe sockets, never own capacity. Both PID and kernel socket must still exist. */
async function alive(entry) {
  try {
    process.kill(entry.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code !== "EPERM") throw error;
  }
  const socket = createServer();
  try {
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.listen(entry.port, "127.0.0.1", resolve);
    });
    return false;
  } catch (error) {
    if (error.code === "EADDRINUSE") return true;
    throw error;
  } finally {
    if (socket.listening) await new Promise((resolve) => socket.close(resolve));
  }
}

async function liveEntries(directory) {
  const entries = [];
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(directory, file), "utf8"));
    } catch (error) {
      // A released owner can unlink its sidecar while we scan. Its socket already owns no capacity.
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (await alive(entry)) entries.push(entry);
    else rmSync(join(directory, file), { force: true });
  }
  return entries;
}

export function waitingMessage(entries, capacity, now = Date.now()) {
  const used = entries.filter((e) => e.state === "running").reduce((n, e) => n + e.slots, 0);
  return [
    `Waiting for gate budget (${used}/${capacity} workers/CPUs in use):`,
    ...entries
      .sort((a, b) => a.sequence - b.sequence)
      .map(
        (e) =>
          `  ${e.state}: ${e.worktree} | ${e.branch} | ${e.command} | PID ${e.pid} | ${e.slots} workers/CPUs | started ${e.started} | elapsed ${Math.max(0, Math.floor((now - Date.parse(e.started)) / 1000))}s`,
      ),
  ].join("\n");
}

/** The short socket mutex serializes atomic sidecar updates; every run owns its own OS-released socket. */
export async function acquireBudget(
  directory,
  request,
  { signal, waiting = () => {}, maxWait, now = Date.now, sleep = pause } = {},
) {
  if (!Number.isSafeInteger(request.slots) || request.slots < 1 || request.slots > request.capacity)
    throw new Error("Invalid gate budget request");
  mkdirSync(directory, { recursive: true });
  const abort = new globalThis.AbortController();
  const combined = globalThis.AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]);
  const timer = maxWait === undefined ? undefined : setTimeout(() => abort.abort(new BusyError()), maxWait * 60_000);
  const started = now();
  const id = randomUUID();
  let owner;
  let registered = false;
  let lastNotice = -Infinity;
  const cleanup = async () => {
    // Never wait for admission during release/timeout: that would defeat --max-wait if the
    // mutex holder is stalled. A concurrent grant can recreate this sidecar, but without its
    // OS socket it is stale and ignored, exactly as after process death.
    await owner?.();
    if (registered) rmSync(join(directory, `${id}.json`), { force: true });
  };
  try {
    owner = await acquireLock(directory, process.platform, undefined, 0, combined);
    for (;;) {
      combined.throwIfAborted();
      if (maxWait !== undefined && now() - started >= maxWait * 60_000) throw new BusyError();
      const unlock = await acquireLock(directory, process.platform, undefined, undefined, combined);
      let entries;
      let mine;
      try {
        entries = await liveEntries(directory);
        if (!registered) {
          const entry = {
            ...request,
            id,
            pid: process.pid,
            port: owner.port,
            started: new Date(started).toISOString(),
            state: "waiting",
            sequence: Math.max(0, ...entries.map((e) => e.sequence)) + 1,
          };
          save(directory, entry);
          registered = true;
          entries.push(entry);
        }
        // A more constrained participant's budget wins if environments report different limits.
        const capacity = Math.min(request.capacity, ...entries.map((e) => e.capacity));
        for (const entry of admit(entries, capacity)) {
          entry.state = "running";
          save(directory, entry);
        }
        mine = entries.find((e) => e.id === id);
      } finally {
        await unlock();
      }
      if (mine.state === "running") {
        combined.throwIfAborted();
        clearTimeout(timer);
        return cleanup;
      }
      if (now() - lastNotice >= 15_000) {
        waiting(
          waitingMessage(
            entries.filter((e) => e.state === "running" || e.sequence < mine.sequence),
            request.capacity,
            now(),
          ),
        );
        lastNotice = now();
      }
      await sleep(250, undefined, { signal: combined });
    }
  } catch (error) {
    await cleanup();
    throw combined.aborted ? combined.reason : error;
  } finally {
    clearTimeout(timer);
  }
}
