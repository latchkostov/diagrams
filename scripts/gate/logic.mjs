import { createHash } from "node:crypto";
import { e2eBuild, selfHostProfiles } from "../e2e-profiles.mjs";
import { shardFiles } from "../e2e-shard.mjs";

export const CATEGORIES = [
  "lint",
  "typecheck",
  "format",
  "i18n",
  "skill",
  "unit",
  "build",
  "size",
  "parity",
  "e2e",
  "docker",
];
export const GIB = 1024 ** 3;
export const gitFiles = (output) => output.split("\0").filter(Boolean);

export function positive(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function options(argv) {
  const result = { command: "full", specs: [], linux: false, docker: true, repeat: 1, only: [] };
  const args = [...argv];
  if (args[0] && !args[0].startsWith("--")) result.command = args.shift();
  if (!["doctor", "setup", "quick", "full"].includes(result.command))
    throw new Error("Use gate doctor|setup|quick|full");
  while (args.length) {
    const arg = args.shift();
    if (arg === "--linux") result.linux = true;
    else if (arg === "--no-docker") result.docker = false;
    else if (arg === "--cpus") {
      const value = args.shift() ?? "";
      if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0)
        throw new Error("--cpus must be a positive CPU count");
      result.cpus = Number(value);
    } else if (arg === "--memory") {
      const value = args.shift() ?? "";
      if (!/^[1-9]\d*(?:[bkmg])?$/i.test(value)) throw new Error("--memory requires a Docker size, e.g. 7g");
      result.memory = value.toLowerCase();
    } else if (arg === "--max-wait") {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) throw new Error("--max-wait must be a positive number");
      result.maxWait = value;
    } else if (arg === "--repeat-each") result.repeatEach = positive(args.shift(), arg);
    else if (["--ports", "--workers", "--repeat"].includes(arg)) result[arg.slice(2)] = positive(args.shift(), arg);
    else if (arg === "--shard") {
      const value = args.shift() ?? "";
      if (!/^[1-9]\d*\/[1-9]\d*$/.test(value)) throw new Error("--shard requires i/n (one-based)");
      const [current, total] = value.split("/").map((n) => positive(n, "--shard"));
      if (current > total) throw new Error("--shard index must not exceed total");
      result.shard = { current, total };
    } else if (arg === "--only") {
      // pnpm.ps1 can join an unquoted PowerShell comma-array with spaces.
      result.only = (args.shift() ?? "").trim().split(/[,\s]+/);
      if (result.only.some((name) => !CATEGORIES.includes(name)))
        throw new Error(`--only accepts ${CATEGORIES.join(",")}`);
    } else if (arg.startsWith("--") || result.command !== "quick") throw new Error(`Unexpected argument: ${arg}`);
    else result.specs.push(arg.replaceAll("\\", "/"));
  }
  if (result.ports) validatePorts(result.ports);
  if (result.linux && !result.docker) throw new Error("--linux requires Docker");
  if ((result.cpus !== undefined || result.memory !== undefined) && !result.linux)
    throw new Error("--cpus and --memory require --linux");
  if (result.shard && (result.command !== "full" || (result.only.length && !result.only.includes("e2e"))))
    throw new Error("--shard requires full with the e2e category");
  return result;
}

export function validatePorts(base) {
  if (!Number.isInteger(base) || base < 1 || base > 65531) throw new Error("Port base must be between 1 and 65531");
  if ([5190, 6000].some((p) => p >= base && p < base + 5))
    throw new Error("Port range includes forbidden port 5190 or 6000");
  return base;
}

// Reserve 4 GiB for the OS, Vite, exports and trace buffers, then allow 2.5 GiB
// per worker and three quarters of logical CPUs, capped at 12. More workers
// measured slower and exposed races. A container's memory
// limit lowers the count further, keeping parallel trace writes within capacity.
export function workerCount(cpus, memory, caps = {}) {
  // CPU quotas need not alter the cpuset, and totalmem can describe the VM rather
  // than its cgroup. Bound both host readings by the explicitly requested limits.
  cpus = Math.min(cpus, caps.cpus ?? Infinity);
  const size = caps.memory?.match(/^(\d+)([bkmg])?$/);
  if (size) memory = Math.min(memory, Number(size[1]) * ({ b: 1, k: 1024, m: 1024 ** 2, g: GIB }[size[2] ?? "b"] ?? 1));
  return Math.max(1, Math.min(12, Math.floor(cpus * 0.75), Math.floor((memory / GIB - 4) / 2.5)));
}

export function resourceRequest(config, capacity) {
  const defaults = config.command === "quick" ? Math.min(2, capacity) : capacity;
  // Admission fixes the worker count before Docker starts. Respect its caps here,
  // rather than letting that explicit count mask cap-aware sizing inside the container.
  const workers =
    config.workers ?? Math.min(defaults, config.linux ? workerCount(Infinity, Infinity, config) : capacity);
  const cpus = config.linux ? (config.cpus ?? workers) : workers;
  const slots = Math.max(workers, Math.ceil(cpus));
  if (slots > capacity)
    throw new Error(`Requested ${slots} workers/CPUs exceeds the host budget ${capacity}; reduce --workers/--cpus`);
  return { workers, cpus, slots };
}

/** Strict FIFO: reserve the available prefix, so later small runs cannot starve a full run. */
export function admit(entries, capacity) {
  const reserved = entries.filter((e) => e.state === "running");
  let free = capacity - reserved.reduce((n, e) => n + e.slots, 0);
  const granted = [];
  for (const entry of entries.filter((e) => e.state === "waiting").sort((a, b) => a.sequence - b.sequence)) {
    if (
      entry.slots > free ||
      reserved.some(
        (other) =>
          (entry.worktree && entry.worktree === other.worktree) ||
          (entry.ports !== undefined && other.ports !== undefined && Math.abs(entry.ports - other.ports) < 5),
      )
    )
      break;
    free -= entry.slots;
    granted.push(entry);
    reserved.push(entry);
  }
  return granted;
}

export function lockPort(common, platform) {
  const key = common.replaceAll("\\", "/");
  const hash = createHash("sha256")
    .update(platform === "win32" ? key.toLowerCase() : key)
    .digest()
    .readUInt32BE();
  // Below the client ephemeral pools on all three hosts.
  return 20000 + (hash % 10000);
}

export function checkTree(status, before, after = before) {
  if (before !== after) throw new Error("HEAD changed during verification; no stamp written");
  if (status.trim())
    throw new Error("Commit or stash tracked and nonignored untracked changes first; verification is for HEAD exactly");
}

export function playwrightCounts(report) {
  const { expected: passed, unexpected: failed, flaky, skipped } = report.stats ?? {};
  if (
    [passed, failed, flaky, skipped].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !(passed + failed + flaky + skipped)
  )
    throw new Error("Missing, empty or invalid Playwright report");
  const projects = {};
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const counts = (projects[test.projectName] ??= { passed: 0, failed: 0, flaky: 0, skipped: 0 });
        const key = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[test.status];
        if (!key) throw new Error(`Unknown Playwright status: ${test.status}`);
        counts[key]++;
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(report);
  return { passed, failed, flaky, skipped, errors: report.errors?.length ?? 0, projects };
}

/** Groups execute sequentially; independent members of a group execute together. */
export function plan(config, changed = [], root) {
  const wanted = new Set(
    config.only.length
      ? config.only
      : config.command === "quick"
        ? ["lint", "typecheck", "format", "i18n", "skill", "unit", "e2e"]
        : CATEGORIES,
  );
  const groups = [];
  const step = (name, args, env = {}) => ({ name, args, env });
  for (const [name, script] of [
    ["lint", "lint"],
    ["typecheck", "typecheck"],
    ["format", "format:check"],
    ["i18n", "i18n"],
    ["skill", "skill:check"],
  ])
    if (wanted.has(name)) groups.push([step(name, [script, ...(name === "i18n" ? ["check"] : [])])]);
  if (wanted.has("unit")) {
    const unitFiles = config.specs.filter((file) => /\.test\.tsx?$/.test(file));
    const targeted = config.command === "quick" && unitFiles.length > 0;
    const args = targeted
      ? ["exec", "vitest", "run", ...unitFiles]
      : config.command === "quick"
        ? ["exec", "node", "scripts/gate/related.mjs"]
        : ["test:coverage"];
    if (config.command !== "quick" || targeted || changed.length)
      groups.push([
        {
          ...step("unit", [...args, "--allowOnly=false"]),
          ...(config.command === "quick" && !targeted ? { related: changed } : {}),
        },
      ]);
    if (config.command !== "quick") groups.push([step("heavy", ["test:heavy", "--allowOnly=false"])]);
  }
  if (wanted.has("build") || wanted.has("size")) groups.push([step("build", ["build"])]);
  if (wanted.has("size")) groups.push([step("size", ["size"])]);
  if (wanted.has("parity")) groups.push([step("parity", ["parity", ...(!config.docker ? ["--tier", "node"] : [])])]);
  if (wanted.has("docker") && config.docker) groups.push([step("docker", ["self-host:smoke"])]);
  const specs = config.shard
    ? shardFiles(config.shard.current, config.shard.total, root)
    : config.specs.length
      ? config.specs.filter((file) => !/\.test\.tsx?$/.test(file))
      : changed.filter((f) => /^tests\/e2e\/.*\.spec\.ts$/.test(f));
  if (wanted.has("e2e") && (config.command !== "quick" || specs.length)) {
    const selfHost = selfHostProfiles(specs);
    groups.push(["e2e", "preview", ...selfHost].map((name) => ({ name: `${name}-build`, ...e2eBuild(name) })));
    for (let i = 1; i <= config.repeat; i++)
      groups.push([
        step(
          `e2e-${i}`,
          [
            "exec",
            "playwright",
            "test",
            ...specs,
            "--retries=0",
            "--forbid-only",
            ...(config.repeatEach ? [`--repeat-each=${config.repeatEach}`] : []),
          ],
          {
            E2E_SELF_HOST: selfHost.join(","),
          },
        ),
      ]);
  }
  return groups;
}

export const canStamp = (config) => config.command === "full" && config.docker && !config.only.length && !config.shard;
