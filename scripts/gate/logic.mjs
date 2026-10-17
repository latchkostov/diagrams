import { createHash } from "node:crypto";

export const CATEGORIES = ["lint", "typecheck", "format", "i18n", "skill", "unit", "build", "size", "parity", "e2e"];
export const GIB = 1024 ** 3;

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
    else if (["--ports", "--workers", "--repeat"].includes(arg)) result[arg.slice(2)] = positive(args.shift(), arg);
    else if (arg === "--only") {
      result.only = (args.shift() ?? "").split(",");
      if (result.only.some((name) => !CATEGORIES.includes(name)))
        throw new Error(`--only accepts ${CATEGORIES.join(",")}`);
    } else if (arg.startsWith("--") || result.command !== "quick") throw new Error(`Unexpected argument: ${arg}`);
    else result.specs.push(arg.replaceAll("\\", "/"));
  }
  if (result.ports) validatePorts(result.ports);
  if (result.linux && !result.docker) throw new Error("--linux requires Docker");
  return result;
}

export function validatePorts(base) {
  if (!Number.isInteger(base) || base < 1 || base > 65531) throw new Error("Port base must be between 1 and 65531");
  if ([5190, 6000].some((p) => p >= base && p < base + 5))
    throw new Error("Port range includes forbidden port 5190 or 6000");
  return base;
}

// Leave capacity for Vite, the OS and exports. RAM bounds each browser worker to 2 GiB
// after a 4 GiB reserve. The cap prevents logical SMT threads from starving real cores.
// Measurements and the chosen cap are recorded in docs/GATE-MEASUREMENTS.md.
export function workerCount(cpus, memory) {
  return Math.max(1, Math.min(16, Math.floor(cpus * 0.75), Math.floor((memory / GIB - 4) / 2)));
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

export const INTERNAL_ENV = {
  VITE_DISABLE_SHARE_LINKS: "1",
  VITE_DISABLE_AI_TOOLS: "1",
  VITE_PRIVATE_BY_DEFAULT: "1",
  VITE_BRAND_NAME: "Acme Diagrams (internal)",
  VITE_LOCALES: "en,de",
};
export const LOCKED_ENV = {
  VITE_DISABLE_SHARE_LINKS: "1",
  VITE_DISABLE_LINK_OPEN: "1",
  VITE_DISABLE_AI_TOOLS: "1",
  VITE_DISABLE_ONDEVICE: "1",
  VITE_PRIVATE_BY_DEFAULT: "1",
  VITE_LOCALES: "en",
};

/** Groups execute sequentially; independent members of a group execute together. */
export function plan(config, changed = []) {
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
    const args =
      config.command === "quick"
        ? ["exec", "vitest", "related", "--run", "--passWithNoTests", ...changed]
        : ["test:coverage"];
    if (config.command !== "quick" || changed.length) groups.push([step("unit", [...args, "--allowOnly=false"])]);
  }
  if (wanted.has("build") || wanted.has("size")) groups.push([step("build", ["build"])]);
  if (wanted.has("size")) groups.push([step("size", ["size"])]);
  if (wanted.has("parity")) groups.push([step("parity", ["parity", ...(!config.docker ? ["--tier", "node"] : [])])]);
  const specs = config.specs.length ? config.specs : changed.filter((f) => /^tests\/e2e\/.*\.spec\.ts$/.test(f));
  if (wanted.has("e2e") && (config.command !== "quick" || specs.length)) {
    const build = (name, env = {}) =>
      step(
        `${name}-build`,
        ["exec", "vite", "build", "--outDir", `tests/.output/${name}-dist`, "--emptyOutDir", "--logLevel", "error"],
        { VITE_E2E: "", ...env },
      );
    groups.push([
      build("e2e", { VITE_E2E: "1" }),
      build("preview"),
      build("internal", INTERNAL_ENV),
      build("locked", LOCKED_ENV),
    ]);
    for (let i = 1; i <= config.repeat; i++)
      groups.push([step(`e2e-${i}`, ["exec", "playwright", "test", ...specs, "--retries=0", "--forbid-only"])]);
  }
  return groups;
}

export const canStamp = (config) => config.command === "full" && config.docker && !config.only.length;
