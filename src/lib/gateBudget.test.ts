import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { afterEach, expect, it, vi } from "vitest";
import { acquireBudget, BUSY_EXIT, BUSY_MESSAGE, type Entry } from "../../scripts/gate/budget.mjs";
import { admit, options, resourceRequest } from "../../scripts/gate/logic.mjs";
import { runSteps } from "../../scripts/gate/run.mjs";
import { acquireLock } from "../../scripts/gate/host.mjs";

const cleanups: (() => Promise<unknown>)[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
function fixture() {
  mkdirSync("tests/.output", { recursive: true });
  const directory = mkdtempSync(resolve("tests/.output/gate-budget-"));
  directories.push(directory);
  return directory;
}
const request = (slots: number, capacity = 4, worktree = fixture()) => ({
  capacity,
  slots,
  worktree,
  branch: "test/budget",
  command: `gate --workers ${slots}`,
});
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const entries = (directory: string): Entry[] =>
  readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(directory, file), "utf8")) as Entry);
async function hold(directory: string, slots: number) {
  const release = await acquireBudget(directory, request(slots));
  // Make cleanup idempotent so tests can release a particular run before afterEach.
  let done = false;
  const cleanup = async () => {
    if (!done) {
      done = true;
      await release();
    }
  };
  cleanups.push(cleanup);
  return cleanup;
}

it("shares a CPU/RAM budget and defaults a full run to the entire capacity", () => {
  expect(resourceRequest(options(["full"]), 8)).toEqual({ workers: 8, cpus: 8, slots: 8 });
  expect(resourceRequest(options(["quick"]), 8).slots).toBe(2);
  expect(resourceRequest(options(["quick"]), 1).slots).toBe(1);
  expect(resourceRequest(options(["full", "--linux", "--workers", "2", "--cpus", "3.5"]), 8)).toEqual({
    workers: 2,
    cpus: 3.5,
    slots: 4,
  });
  expect(resourceRequest(options(["full", "--linux", "--workers", "4", "--cpus", "2"]), 8).slots).toBe(4);
  expect(() => resourceRequest(options(["full", "--workers", "9"]), 8)).toThrow("exceeds");
  expect(() => resourceRequest(options(["full", "--linux", "--cpus", "9"]), 8)).toThrow("exceeds");
});

it("validates bounded waits and CPU budgets", () => {
  expect(options(["quick", "--max-wait", "1"]).maxWait).toBe(1);
  for (const arg of ["--max-wait", "--cpus"])
    for (const value of [undefined, "", "0", "-1", "NaN", "Infinity"])
      expect(() => options(["quick", "--linux", arg, ...(value === undefined ? [] : [value])])).toThrow(arg);
  expect(() => options(["full", "--cpus", "2"])).toThrow("--linux");
});

it("combines container caps, bounded admission and every execution option", () => {
  const config = options([
    "full",
    "--linux",
    "--cpus",
    "3",
    "--memory",
    "7g",
    "--max-wait",
    "1",
    "--workers",
    "2",
    "--shard",
    "1/2",
    "--repeat",
    "3",
    "--only",
    "unit,e2e",
    "--ports",
    "6660",
  ]);
  expect(config).toMatchObject({
    linux: true,
    cpus: 3,
    memory: "7g",
    maxWait: 1,
    workers: 2,
    shard: { current: 1, total: 2 },
    repeat: 3,
    only: ["unit", "e2e"],
    ports: 6660,
  });
  expect(resourceRequest(config, 8)).toEqual({ workers: 2, cpus: 3, slots: 3 });
});

it("respects container caps before reserving auto workers without losing explicit overrides", () => {
  const args = ["--linux", "--cpus", "3", "--memory", "7g", "--max-wait", "1"];
  for (const mode of ["full", "quick"])
    expect(resourceRequest(options([mode, ...args]), 8)).toEqual({ workers: 1, cpus: 3, slots: 3 });
  expect(resourceRequest(options(["full", ...args, "--workers", "4"]), 8)).toEqual({
    workers: 4,
    cpus: 3,
    slots: 4,
  });
  expect(resourceRequest(options(["full", "--linux", "--memory", "7g"]), 8)).toEqual({
    workers: 1,
    cpus: 1,
    slots: 1,
  });
});

it("admits the FIFO prefix without exceeding capacity or letting small requests bypass a full run", () => {
  const running = { state: "running", slots: 2, sequence: 1 };
  const full = { state: "waiting", slots: 4, sequence: 2 };
  const quick = { state: "waiting", slots: 1, sequence: 3 };
  expect(admit([quick, full, running], 4)).toEqual([]);
  expect(admit([quick, full], 4)).toEqual([full]);
  expect(admit([{ ...quick, sequence: 0 }, full], 4)).toEqual([{ ...quick, sequence: 0 }]);
  expect(admit([running, quick, { ...quick, sequence: 4 }], 4)).toHaveLength(2);
});

it("keeps overlapping explicit ranges queued, including unaligned bases, and allows adjacent ranges", () => {
  const running = { state: "running", slots: 1, sequence: 1, worktree: "a", ports: 6662 };
  const waiting = { state: "waiting", slots: 1, sequence: 2, worktree: "b", ports: 6660 };
  expect(admit([running, waiting], 4)).toEqual([]);
  expect(admit([running, { ...waiting, ports: 6666 }], 4)).toEqual([]);
  expect(admit([running, { ...waiting, ports: 6667 }], 4)).toHaveLength(1);
});

it("preserves the established host capacity when a constrained waiter joins behind a full run", async () => {
  const directory = fixture();
  const first = await acquireBudget(directory, request(2, 8));
  cleanups.push(first);
  const fullWaiting = deferred();
  const full = acquireBudget(directory, request(8, 8), { waiting: () => fullWaiting.resolve() });
  await fullWaiting.promise;
  const smallWaiting = deferred();
  const small = acquireBudget(directory, request(1, 2), { waiting: () => smallWaiting.resolve() });
  await smallWaiting.promise;
  expect(entries(directory).map((e) => e.capacity)).toEqual([8, 8, 8]);
  await first();
  cleanups.pop();
  const releaseFull = await full;
  expect(entries(directory).find((e) => e.slots === 1)?.state).toBe("waiting");
  await releaseFull();
  await (
    await small
  )();
  expect(entries(directory)).toEqual([]);
});

it("rejects a request larger than the established capacity before it can stall the FIFO", async () => {
  const directory = fixture();
  const first = await acquireBudget(directory, request(1, 2));
  cleanups.push(first);
  await expect(acquireBudget(directory, request(8, 8))).rejects.toThrow("active host budget 2");
  const second = await acquireBudget(directory, request(1, 8));
  await second();
  expect(entries(directory)).toHaveLength(1);
});

function childGate(directory: string, input: ReturnType<typeof request> & { ports?: number }) {
  const module = pathToFileURL(resolve("scripts/gate/budget.mjs")).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { acquireBudget } from ${JSON.stringify(module)};
      const release = await acquireBudget(${JSON.stringify(directory)}, ${JSON.stringify(input)}, {
        maxWait: 1,
        waiting: () => process.send({ state: "waiting" })
      });
      process.send({ state: "running", ports: release.ports });
      process.once("message", async () => { await release(); process.disconnect(); });
    `,
    ],
    { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
  );
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  return child;
}

it("reserves different automatic port ranges for two processes in different worktrees before servers start", async () => {
  const directory = fixture();
  const first = childGate(directory, request(1));
  const [a] = await once(first, "message");
  expect(a.state).toBe("running");
  const second = childGate(directory, request(1));
  const [b] = await once(second, "message");
  expect(b.state).toBe("running");
  expect(Math.abs(a.ports - b.ports)).toBeGreaterThanOrEqual(5);
  expect(
    entries(directory)
      .map((e) => e.ports)
      .sort(),
  ).toEqual([a.ports, b.ports].sort());
  const exited = once(first, "exit");
  first.kill();
  await exited;
  // Death frees the reservation even though its sidecar remains until the next scan.
  const third = await acquireBudget(directory, { ...request(1), ports: a.ports });
  expect(third.ports).toBe(a.ports);
  await third();
});

it("makes a second process in the same canonical checkout wait despite spare workers and different ports", async () => {
  const directory = fixture();
  const worktree = fixture();
  const alias = join(fixture(), "alias");
  symlinkSync(worktree, alias, process.platform === "win32" ? "junction" : "dir");
  const first = childGate(directory, request(1, 4, worktree));
  const [a] = await once(first, "message");
  expect(a.state).toBe("running");
  const second = childGate(directory, { ...request(1, 4, alias), ports: a.ports + 10 });
  const [b] = await once(second, "message");
  expect(b.state).toBe("waiting");
  expect(entries(directory).filter((e) => e.state === "running")).toHaveLength(1);
  const resumed = once(second, "message");
  first.send("release");
  expect((await resumed)[0].state).toBe("running");
});

it.each(["automatic", "explicit"])("excludes overlaps with %s port reservations", async (mode) => {
  const directory = fixture();
  const first = await acquireBudget(directory, { ...request(1), ports: mode === "explicit" ? 6662 : undefined });
  cleanups.push(first);
  const waiting = deferred();
  const overlap = acquireBudget(
    directory,
    { ...request(1), ports: first.ports + 2 },
    {
      waiting: () => waiting.resolve(),
      probe: async (base) => base,
    },
  );
  await waiting.promise;
  const [holder] = entries(directory).filter((e) => e.state === "running");
  expect(holder.ports).toBe(first.ports);
  await first();
  cleanups.pop();
  const second = await overlap;
  expect(second.ports).toBe(first.ports + 2);
  await second();
});

it.each([
  ["checkout", "deadline"],
  ["checkout", "cancellation"],
  ["ports", "deadline"],
  ["ports", "cancellation"],
])("cleans up a %s waiter on %s", async (lease, reason) => {
  const directory = fixture();
  const worktree = fixture();
  const first = await acquireBudget(
    directory,
    { ...request(1, 4, worktree), ports: 6660 },
    {
      probe: async (port) => port,
    },
  );
  cleanups.push(first);
  const abort = new AbortController();
  let now = 0;
  const queued = acquireBudget(
    directory,
    { ...request(1, 4, lease === "checkout" ? worktree : fixture()), ports: lease === "checkout" ? 6670 : 6662 },
    {
      maxWait: 1,
      signal: abort.signal,
      now: () => now,
      sleep: async () => {
        if (reason === "deadline") now = 60_000;
        else abort.abort(new Error("cancelled checkout waiter"));
      },
    },
  );
  await expect(queued).rejects.toMatchObject(
    reason === "deadline" ? { exitCode: 75 } : { message: "cancelled checkout waiter" },
  );
  expect(entries(directory)).toHaveLength(1);
  expect(entries(directory)[0].ports).toBe(first.ports);
});

it("runs two two-worker quick gates together and gives a queued full run priority over later quick gates", async () => {
  const directory = fixture();
  const first = await hold(directory, 2);
  const second = await hold(directory, 2);
  expect(entries(directory).filter((e) => e.state === "running")).toHaveLength(2);
  const fullWaiting = deferred();
  const full = acquireBudget(directory, request(4), { waiting: () => fullWaiting.resolve() });
  await fullWaiting.promise;
  const quickWaiting = deferred();
  const quick = acquireBudget(directory, request(1), { waiting: () => quickWaiting.resolve() });
  await quickWaiting.promise;
  await first();
  expect(entries(directory).filter((e) => e.state === "waiting")).toHaveLength(2);
  await second();
  const releaseFull = await full;
  expect(entries(directory).find((e) => e.slots === 1)?.state).toBe("waiting");
  await releaseFull();
  await (
    await quick
  )();
  expect(entries(directory)).toEqual([]);
});

it("refreshes holder details and expires a max-wait minute with a distinct busy code", async () => {
  const directory = fixture();
  await hold(directory, 4);
  const messages: string[] = [];
  const start = Date.parse(entries(directory)[0].started);
  let elapsed = 0;
  await expect(
    acquireBudget(directory, request(4), {
      maxWait: 1,
      now: () => start + elapsed,
      waiting: (message) => messages.push(message),
      sleep: () => {
        elapsed += 15_000;
        return Promise.resolve();
      },
    }),
  ).rejects.toMatchObject({ message: BUSY_MESSAGE, exitCode: BUSY_EXIT });
  expect(BUSY_EXIT).toBe(75);
  expect(messages).toHaveLength(4);
  for (const message of messages) {
    expect(message).toContain(entries(directory)[0].worktree);
    expect(message).toContain("test/budget");
    expect(message).toContain("gate --workers 4");
    expect(message).toContain("started ");
    expect(message).toContain(`PID ${process.pid}`);
  }
  expect(messages[3]).toContain("elapsed 45s");
  expect(entries(directory)).toHaveLength(1);
});

it("cancels a queued run without releasing anyone else's reservation", async () => {
  const directory = fixture();
  await hold(directory, 4);
  const abort = new AbortController();
  const waiting = deferred();
  const queued = acquireBudget(directory, request(4), { signal: abort.signal, waiting: () => waiting.resolve() });
  await waiting.promise;
  abort.abort(new Error("cancelled"));
  await expect(queued).rejects.toThrow("cancelled");
  expect(entries(directory)).toHaveLength(1);
});

it("expires while blocked acquiring the admission mutex, before that mutex is released", async () => {
  const directory = fixture();
  await hold(directory, 4);
  const blocked = deferred();
  let unlock!: () => Promise<void>;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const queued = acquireBudget(directory, request(4), {
      maxWait: 1,
      lock: (key, platform, waiting, port, signal) =>
        acquireLock(key, platform, port === undefined ? () => blocked.resolve() : waiting, port, signal),
      sleep: async () => {
        unlock = await acquireLock(directory, process.platform);
        cleanups.push(unlock);
      },
    });
    const expired = expect(queued).rejects.toMatchObject({ message: BUSY_MESSAGE, exitCode: BUSY_EXIT });
    await blocked.promise;
    expect(entries(directory)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await expired;
    expect(entries(directory)).toHaveLength(1);
    // The queued owner's socket/sidecar must be gone while the mutex is still held.
    expect(unlock).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

function budgetSubprocess(source: string, timeout = 10_000) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    windowsHide: true,
    timeout,
  });
}

it("bounds a stalled synchronous subprocess with a hang backstop", () => {
  const result = budgetSubprocess("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)", 1_000);
  expect(result.error).toMatchObject({ code: "ETIMEDOUT" });
  expect(result.status).not.toBe(0);
});

it("tolerates an owner unlinking its sidecar during the admission scan", () => {
  const directory = fixture();
  const file = join(directory, "released.json");
  writeFileSync(file, "{}");
  const module = pathToFileURL(resolve("scripts/gate/budget.mjs")).href;
  const result = budgetSubprocess(`
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { acquireBudget } from ${JSON.stringify(module)};
    const read = fs.readFileSync;
    let raced = false;
    fs.readFileSync = (file, ...args) => {
      if (file === ${JSON.stringify(file)}) {
        raced = true;
        fs.rmSync(file);
      }
      return read(file, ...args);
    };
    syncBuiltinESMExports();
    const release = await acquireBudget(${JSON.stringify(directory)}, ${JSON.stringify(request(4))});
    await release();
    if (!raced) throw Error("Did not exercise the unlink race");
  `);
  expect(result.error, String(result.error)).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(entries(directory)).toEqual([]);
});

it.each(["running", "waiting"])("releases a dead %s process's capacity and FIFO position", async (state) => {
  const directory = fixture();
  const release = state === "waiting" ? await hold(directory, 2) : undefined;
  const module = pathToFileURL(resolve("scripts/gate/budget.mjs")).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireBudget } from ${JSON.stringify(module)};
    await acquireBudget(${JSON.stringify(directory)}, ${JSON.stringify(request(4))}, {
      waiting: () => process.send("waiting")
    });
    process.send("running");
  `,
    ],
    { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
  );
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  const [status] = await once(child, "message");
  expect(status).toBe(state);
  const waiting = deferred();
  const contender = acquireBudget(directory, request(4), { waiting: () => waiting.resolve() });
  await waiting.promise;
  const exited = once(child, "exit");
  child.kill();
  await exited;
  await release?.();
  await (
    await contender
  )();
  expect(entries(directory)).toEqual([]);
});

it("ignores a stale sidecar even if its PID is reused, when its OS socket is released", async () => {
  const directory = fixture();
  await hold(directory, 4);
  const [old] = entries(directory);
  await cleanups.pop()?.();
  writeFileSync(join(directory, `${old.id}.json`), JSON.stringify(old));
  let now = Date.now();
  await (
    await acquireBudget(directory, request(4), {
      maxWait: 1,
      now: () => now,
      sleep: () => {
        now += 60_000;
        return Promise.resolve();
      },
    })
  )();
  expect(entries(directory)).toEqual([]);
});

it("applies declared workers to unit tests and both parity tiers", async () => {
  const directory = fixture();
  const calls: { args: string[]; env: Record<string, string> }[] = [];
  await runSteps(
    process.cwd(),
    options(["quick", "--workers", "2", "--only", "unit,parity"]),
    ["src/lib/gateBudget.test.ts"],
    directory,
    {},
    async (args, { env }) => {
      calls.push({ args, env });
      if (args.includes("vitest"))
        writeFileSync(
          join(directory, "unit/results.json"),
          JSON.stringify({
            success: true,
            numPassedTests: 1,
            numFailedTests: 0,
            numPendingTests: 0,
          }),
        );
      return { code: 0, text: "Parity: 1 goldens, 0 changed, 0 added, 0 missing, 0 stale" };
    },
  );
  expect(calls[0].args).toContain("--maxWorkers=2");
  expect(calls[1].env).toMatchObject({ PARITY_WORKERS: "2", GATE_WORKERS: "2" });
});

it("keeps concurrent build profiles within the declared worker budget", async () => {
  const directory = fixture();
  let active = 0;
  let maximum = 0;
  const result = await runSteps(
    process.cwd(),
    options(["quick", "tests/e2e/smoke.spec.ts", "--only", "e2e", "--workers", "1"]),
    [],
    directory,
    {},
    async (args, { env }) => {
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      if (args.includes("playwright"))
        writeFileSync(
          env.PLAYWRIGHT_JSON_OUTPUT_NAME,
          JSON.stringify({
            stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
          }),
        );
      active--;
      return { code: 0, text: "" };
    },
  );
  expect(result.failures).toBe(0);
  expect(maximum).toBe(1);
});
