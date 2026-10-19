import console from "node:console";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import process from "node:process";
import { expect, it, vi } from "vitest";
import {
  canStamp,
  checkTree,
  gitFiles,
  GIB,
  lockPort,
  options,
  plan,
  playwrightCounts,
  validatePorts,
  workerCount,
} from "../../scripts/gate/logic.mjs";
import { acquireLock, pickPorts, probePorts } from "../../scripts/gate/host.mjs";
import { browserTemp, prepareBrowserTemp, runSteps } from "../../scripts/gate/run.mjs";
import { linuxRun } from "../../scripts/gate/linux.mjs";
import { installed } from "../../scripts/gate/doctor.mjs";
import { command, git, pnpmCommand } from "../../scripts/gate/commands.mjs";
import { runGate } from "../../scripts/gate.mjs";
import { acquireBudget } from "../../scripts/gate/budget.mjs";

it("invokes standalone pnpm and JS shims without shell interpretation", () => {
  const args = ["exec", "tool", "a path with spaces", "$(literal)"];
  expect(pnpmCommand(args, process.execPath)).toEqual([process.execPath, args]);
  expect(pnpmCommand(args, "pnpm.cjs")).toEqual([process.execPath, ["pnpm.cjs", ...args]]);
});

const config = (args: string[] = []) => options(["full", ...args]);

it("accepts Linux CPU quotas and Docker memory sizes without requiring worker overrides", () => {
  expect(config(["--linux", "--cpus", "3", "--memory", "7g"])).toMatchObject({ cpus: 3, memory: "7g" });
  expect(config(["--linux", "--cpus", "0.5", "--memory", "512M"])).toMatchObject({ cpus: 0.5, memory: "512m" });
});

it.each([
  ["--cpus", "3"],
  ["--memory", "7g"],
  ["--linux", "--cpus", "0"],
  ["--linux", "--cpus", "NaN"],
  ["--linux", "--memory", "0g"],
  ["--linux", "--memory", "7gb"],
  ["--linux", "--memory"],
  ["--linux", "--cpus"],
])("rejects unusable or native-only resource caps (%s)", (...args) => {
  expect(() => config(args)).toThrow();
});

it("sizes auto workers from capped resources even when Node sees the host", () => {
  expect(workerCount(32, 64 * GIB, { cpus: 3, memory: "7g" })).toBe(1);
  expect(workerCount(32, 64 * GIB, { cpus: 3, memory: "16g" })).toBe(2);
  expect(workerCount(32, 64 * GIB, { cpus: 0.5, memory: "512m" })).toBe(1);
  expect(workerCount(2, 7 * GIB, { cpus: 8, memory: "32g" })).toBe(1);
});

it("keeps command stdout separate from diagnostic stderr", async () => {
  const result = await command(process.execPath, [
    "-e",
    'process.stdout.write("مثال.ts\\0"); process.stderr.write("warning\\n")',
  ]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("مثال.ts\0");
  expect(result.stderr).toBe("warning\n");
  expect(result.text).toContain(result.stdout);
  expect(result.text).toContain(result.stderr);
});

it("Git diagnostics cannot become changed file names", async () => {
  const stdout = "tests/e2e/smoke.spec.ts\0";
  const stderr = "warning: CRLF will be replaced by LF\n";
  expect(
    await git(["diff", "--name-only", "-z"], process.cwd(), async () => ({
      code: 0,
      text: stderr + stdout,
      stdout,
      stderr,
    })),
  ).toBe(stdout);
});

it("reads zero-delimited Git paths without quoting or splitting valid file names", () => {
  const files = ["tests/e2e/my file.spec.ts", "src/i18n/مثال.ts", "dir/line\nbreak.ts"];
  expect(gitFiles(files.join("\0") + "\0")).toEqual(files);
  expect(gitFiles("")).toEqual([]);
});

it.each(["unit,e2e", "unit e2e", "unit, e2e"])("accepts native and PowerShell category lists (%s)", (list) => {
  expect(config(["--only", list]).only).toEqual(["unit", "e2e"]);
});

it("keeps container browser profiles on the source volume and native profiles on the repo drive", () => {
  const root = resolve("tests/.output/volume-source");
  const report = join(root, "reports/run");
  expect(browserTemp(root, report, true)).toBe(join(root, "tests/.output/tmp/browser"));
  expect(browserTemp(root, report)).toBe(join(report, "tmp"));
});

it("cleans browser profiles without unlinking a mount root or escaping the repository", () => {
  mkdirSync("tests/.output", { recursive: true });
  const dir = mkdtempSync(resolve("tests/.output/gate-temp-"));
  const removed: string[] = [];
  try {
    mkdirSync(join(dir, "tmp"));
    writeFileSync(join(dir, "tmp/stale"), "profile");
    expect(prepareBrowserTemp(process.cwd(), dir, false, (path) => removed.push(path))).toBe(join(dir, "tmp"));
    expect(removed).toEqual([join(dir, "tmp/stale")]);
    expect(() => prepareBrowserTemp(process.cwd(), resolve("../outside-repo"))).toThrow("inside the repository");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it.each(["", "bind"])(
  "copies Linux reports after the run rather than writing them through a host mount (%s)",
  async (source) => {
    mkdirSync("tests/.output", { recursive: true });
    const dir = mkdtempSync(resolve("tests/.output/gate-copy-"));
    const calls: string[][] = [];
    const changed = Array.from({ length: 500 }, (_, i) => `src/path ${i}/${"x".repeat(80)}.ts`);
    vi.stubEnv("GATE_LINUX_SOURCE", source);
    const execute = async (bin: string, args: string[]) => {
      calls.push([bin, ...args]);
      if (args[0] === "info") return { code: 0, text: "linux-test" };
      if (args[0] === "cp" && args[1].endsWith("/.")) {
        expect(args[2]).toBe(dir);
        writeFileSync(
          join(dir, "summary.json"),
          JSON.stringify({ rows: [], reports: [], failures: 0, workers: 10, seconds: 0 }),
        );
      }
      return { code: 0, text: "" };
    };
    try {
      const result = await linuxRun(
        process.cwd(),
        config(["--linux", "--workers", "2", "--cpus", "3", "--memory", "7g", "--max-wait", "1"]),
        changed,
        dir,
        "test-head",
        {
          command: execute,
          required: execute,
        },
      );
      expect(result.failures).toBe(0);
      const run = calls.find((c) => c[0] === "docker" && c[1] === "run");
      if (!run) throw new Error("No container run");
      expect(run.join(" ").length).toBeLessThan(2500);
      expect(run.at(-1)).toBe("/gate-config.json");
      expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).changed).toEqual(changed);
      expect(run.slice(run.indexOf("--cpus"), run.indexOf("--cpus") + 2)).toEqual(["--cpus", "3"]);
      expect(run.slice(run.indexOf("--memory"), run.indexOf("--memory") + 2)).toEqual(["--memory", "7g"]);
      const name = `ld-gate-${process.pid}-${basename(dir)}`;
      const mounts = run.filter((_, i) => ["-v", "--mount"].includes(run[i - 1]));
      expect(mounts).toContain(`${join(dir, "config.json")}:/gate-config.json:ro`);
      expect(mounts).toContain(
        `type=volume,source=${name}-reports,target=/work/tests/.output/g/${basename(dir)},volume-nocopy`,
      );
      expect(mounts).toContain(`type=volume,source=${name}-profiles,target=/work/tests/.output/tmp,volume-nocopy`);
      expect(mounts.some((mount) => mount.startsWith(`${dir}:`))).toBe(false);
      expect(calls.some((c) => c[1] === "volume" && c[2] === "rm" && c.includes(`${name}-reports`))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
const names = (args: string[] = []) =>
  plan(config(args))
    .flat()
    .map((s: { name: string }) => s.name);

it("rejects forbidden ranges and malformed bases", () => {
  for (const port of [5190, 6000])
    for (let offset = 0; offset < 5; offset++) expect(() => validatePorts(port - offset)).toThrow("forbidden");
  for (const port of [0, -1, 1.2, 65532, NaN]) expect(() => validatePorts(port)).toThrow();
  expect(validatePorts(6480)).toBe(6480);
});

it("picks whole ranges in the advertised pool", async () => {
  const calls: number[] = [];
  expect(
    await pickPorts(async (port: number) => {
      calls.push(port);
      if (port < 6410) throw new Error("busy");
      return port;
    }),
  ).toBe(6410);
  expect(calls).toEqual([6400, 6405, 6410]);
  await expect(
    pickPorts(async () => {
      throw new Error("busy");
    }),
  ).rejects.toThrow("No free");
});

it("detects non-HTTP listeners without closing them", async () => {
  const server = createServer();
  // Stay out of the client ephemeral pool. A released ephemeral sibling can be
  // claimed by a connection (or denied by Windows) before the probe reaches it.
  for (let port = 20000 + (process.pid % 5000); port < 30000; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (error) {
      if (!["EACCES", "EADDRINUSE"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no listener");
  try {
    await expect(probePorts(address.port)).rejects.toThrow(`Port ${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each([
  [32, 64, 12],
  [10, 24, 7],
  [4, 16, 3],
  [32, 12, 3],
  [32, 31.2, 10],
  [1, 2, 1],
  [128, 256, 12],
])("bounds workers by CPU and RAM (%s, %s GiB)", (cpus, ram, expected) => {
  expect(workerCount(cpus, ram * GIB)).toBe(expected);
});

it("normalizes Windows lock keys across worktrees", () => {
  expect(lockPort("C:\\repo\\.git", "win32")).toBe(lockPort("c:/REPO/.git", "win32"));
  expect(lockPort("/repo/.git", "darwin")).toBe(lockPort("/repo/.git", "linux"));
});

it("queues a contender until release", async () => {
  const key = `gate-unit-release-${process.pid}`;
  const release = await acquireLock(key, process.platform, undefined, 0);
  let waiting!: () => void;
  const queued = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const second = acquireLock(key, process.platform, waiting, release.port);
  await queued;
  await release();
  await (
    await second
  )();
  await (
    await acquireLock(key, process.platform, undefined, 0)
  )();
});

it("the OS releases a lock when its holder dies", async () => {
  const key = `gate-unit-death-${process.pid}`;
  const module = pathToFileURL(resolve("scripts/gate/host.mjs")).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { acquireLock } from ${JSON.stringify(module)}; const release = await acquireLock(${JSON.stringify(key)}, process.platform, undefined, 0); process.send(release.port);`,
    ],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  try {
    const [port] = (await once(child, "message")) as [number];
    let waiting!: () => void;
    const queued = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const contender = acquireLock(key, process.platform, waiting, port);
    await queued;
    const dead = once(child, "exit");
    child.kill();
    await dead;
    await (
      await contender
    )();
  } finally {
    child.kill();
  }
});

it("parses JSON counts by project and rejects empty or malformed reports", () => {
  const report = {
    stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 1 },
    errors: [],
    suites: [
      {
        specs: [
          {
            tests: [
              { projectName: "dev", status: "expected" },
              { projectName: "chromium", status: "expected" },
              { projectName: "dev", status: "unexpected" },
              { projectName: "dev", status: "flaky" },
              { projectName: "locked", status: "skipped" },
            ],
          },
        ],
      },
    ],
  };
  expect(playwrightCounts(report)).toMatchObject({
    passed: 2,
    failed: 1,
    flaky: 1,
    skipped: 1,
    projects: { dev: { passed: 1, failed: 1, flaky: 1, skipped: 0 } },
  });
  for (const stats of [{}, { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }, { expected: -1 }])
    expect(() => playwrightCounts({ stats })).toThrow();
});

it("rejects dirty trees including untracked files, and a changed HEAD", () => {
  expect(() => checkTree("", "abc", "abc")).not.toThrow();
  for (const status of [" M file.ts", "?? file.ts"]) expect(() => checkTree(status, "abc")).toThrow("Commit or stash");
  expect(() => checkTree("", "abc", "def")).toThrow("HEAD changed");
});

it.each([undefined, 6660])("holds checkout and port leases throughout orchestration (%s)", async (ports) => {
  mkdirSync("tests/.output", { recursive: true });
  const root = mkdtempSync(resolve("tests/.output/gate-leases-"));
  const budget = join(root, "budget");
  const readEntries = () =>
    readdirSync(budget)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(join(budget, name), "utf8")));
  const expected = ports ?? 6400;
  try {
    await expect(
      runGate(options(["quick", ...(ports ? ["--ports", String(ports)] : [])]), {
        root,
        git: async () => root,
        acquireBudget: (_, request, options) =>
          acquireBudget(budget, request, { ...options, probe: async (port) => port }),
        doctor: async () => {
          expect(readEntries()).toMatchObject([{ state: "running", ports: expected }]);
          return true;
        },
        runSteps: async (_, config) => {
          expect(config.ports).toBe(expected);
          expect(readEntries()).toMatchObject([{ state: "running", ports: expected }]);
          throw new Error("injected runner failure");
        },
      }),
    ).rejects.toThrow("injected runner failure");
    expect(readEntries()).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("full gate stamps only a complete unchanged-HEAD success", async () => {
  mkdirSync("tests/.output", { recursive: true });
  const root = mkdtempSync(resolve("tests/.output/gate-stamps-"));
  const stampDir = join(root, "stamps");
  mkdirSync(stampDir);
  const stamp = join(stampDir, "original-head");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const scenario of [
      "command failure",
      "throw",
      "tree change",
      "HEAD change",
      "flaky",
      "subset",
      "no docker",
      "success",
    ]) {
      writeFileSync(stamp, "stale stamp");
      let finished = false;
      const commands: string[][] = [];
      const run = () =>
        runGate(
          config([
            "--ports",
            "6480",
            ...(scenario === "subset" ? ["--only", "unit"] : scenario === "no docker" ? ["--no-docker"] : []),
          ]),
          {
            root,
            stampDir,
            git: async (args) =>
              args.includes("--git-common-dir")
                ? root
                : args[0] === "status"
                  ? finished && scenario === "tree change"
                    ? "?? late-file"
                    : ""
                  : finished && scenario === "HEAD change"
                    ? "new-head"
                    : "original-head",
            acquireBudget: async (_, request) => Object.assign(async () => {}, { ports: request.ports! }),
            doctor: async () => true,
            runSteps: async (cwd, config, changed, directory) => {
              const result = await runSteps(cwd, config, changed, directory, {}, async (args, { env }) => {
                commands.push(args);
                if (scenario === "throw") throw new Error("injected command error");
                if (args.includes("playwright"))
                  writeFileSync(
                    env.PLAYWRIGHT_JSON_OUTPUT_NAME,
                    JSON.stringify({
                      stats: { expected: 1, unexpected: 0, flaky: scenario === "flaky" ? 1 : 0, skipped: 0 },
                    }),
                  );
                if (args.includes("test:coverage"))
                  writeFileSync(
                    join(directory, "unit/results.json"),
                    JSON.stringify({
                      success: true,
                      numPassedTests: 1,
                      numFailedTests: 0,
                      numPendingTests: 0,
                    }),
                  );
                return {
                  code: scenario === "command failure" && args[0] === "lint" ? 1 : 0,
                  text: args[0] === "parity" ? "Parity: 1 goldens, 0 changed, 0 added, 0 missing, 0 stale" : "",
                };
              });
              finished = true;
              return result;
            },
          },
        );
      if (scenario === "throw") await expect(run()).rejects.toThrow("injected command error");
      else expect(await run(), scenario).toBe(["success", "subset", "no docker"].includes(scenario) ? 0 : 1);
      expect(existsSync(stamp), scenario).toBe(scenario === "success");
      if (scenario === "success") {
        expect(commands).toHaveLength(plan(config()).flat().length);
        expect(readFileSync(stamp, "utf8")).toContain("gate_failures=0");
      }
    }
  } finally {
    log.mockRestore();
    error.mockRestore();
    warn.mockRestore();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("plans all CI builds together without shards or retries", () => {
  expect(names()).toEqual([
    "lint",
    "typecheck",
    "format",
    "i18n",
    "skill",
    "unit",
    "build",
    "size",
    "parity",
    "e2e-build",
    "preview-build",
    "internal-build",
    "locked-build",
    "e2e-1",
  ]);
  const groups = plan(config(["--repeat", "3"]));
  expect(groups.find((g: { name: string }[]) => g.some((s) => s.name === "e2e-build"))).toHaveLength(4);
  const e2e = groups.flat().filter((s: { name: string }) => /^e2e-\d$/.test(s.name));
  expect(e2e).toHaveLength(3);
  expect(e2e[0].args).toEqual(["exec", "playwright", "test", "--retries=0", "--forbid-only"]);
});

it("quick selects only changed or explicit specs", () => {
  const changed = ["src/model/types.ts", "tests/e2e/example.spec.ts", "docs/QUALITY.md"];
  const steps = plan(options(["quick"]), changed).flat();
  expect(steps.find((s: { name: string }) => s.name === "unit")?.related).toEqual(changed);
  const e2e = steps.find((s: { name: string }) => s.name === "e2e-1");
  expect(e2e?.args).toContain(changed[1]);
  expect(e2e?.args).not.toContain(changed[0]);
  expect(
    plan(options(["quick"]), [])
      .flat()
      .map((s: { name: string }) => s.name),
  ).toEqual(["lint", "typecheck", "format", "i18n", "skill"]);
  expect(
    plan(options(["quick", "tests/e2e/explicit.spec.ts"]), changed)
      .flat()
      .at(-1)?.args,
  ).toContain("tests/e2e/explicit.spec.ts");
});

it("passes 500 related paths by file without expanding the command line", async () => {
  mkdirSync("tests/.output", { recursive: true });
  const dir = mkdtempSync(resolve("tests/.output/gate-related-"));
  const changed = Array.from({ length: 500 }, (_, i) => `src/a long directory ${i}/مثال ${"x".repeat(80)}.ts`);
  changed.push("dir/line\nbreak.ts", "tests/parity/golden/output.json");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const result = await runSteps(
      process.cwd(),
      options(["quick", "--only", "unit"]),
      changed,
      dir,
      {},
      async (args) => {
        expect(args.join(" ").length).toBeLessThan(1000);
        expect(args.slice(0, 3)).toEqual(["exec", "node", "scripts/gate/related.mjs"]);
        expect(JSON.parse(readFileSync(args[3], "utf8"))).toEqual(changed);
        writeFileSync(
          join(dir, "unit/results.json"),
          JSON.stringify({ success: true, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0 }),
        );
        return { code: 0, text: "" };
      },
    );
    expect(result.failures).toBe(0);
  } finally {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("the JSON launcher runs only related tests, forwards options and rejects invalid path lists", async () => {
  mkdirSync("tests/.output", { recursive: true });
  const dir = mkdtempSync(resolve("tests/.output/gate-launcher-"));
  const launcher = resolve("scripts/gate/related.mjs");
  const paths = join(dir, "changed paths.json");
  const report = join(dir, "results.json");
  const configFile = join(dir, "vitest.config.mjs");
  writeFileSync(configFile, `export default { root: ${JSON.stringify(dir)}, test: { include: ["*.test.mjs"] } };`);
  writeFileSync(join(dir, "source with spaces مثال.mjs"), "export const value = 42;");
  writeFileSync(
    join(dir, "selected.test.mjs"),
    `
    import { expect, it } from "vitest";
    import { value } from "./source with spaces مثال.mjs";
    it("selected through JSON", () => expect(value).toBe(42));
  `,
  );
  writeFileSync(
    join(dir, "unrelated.test.mjs"),
    `import { it } from "vitest"; it("unrelated", () => { throw new Error("Unrelated test ran"); });`,
  );
  const changed = Array.from({ length: 500 }, (_, i) => join(dir, `missing ${i} مثال.mjs`));
  changed.push(join(dir, "source with spaces مثال.mjs"));
  const run = (args: string[] = []) =>
    command(process.execPath, [launcher, paths, "--config", configFile, "--maxWorkers=1", ...args]);
  try {
    writeFileSync(paths, JSON.stringify(changed));
    const result = await run(["--reporter=json", "--outputFile", report]);
    expect(result.code, result.text).toBe(0);
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ numPassedTests: 1, numFailedTests: 0 });
    const filtered = await run(["--testNamePattern=does not match", "--reporter=json", "--outputFile", report]);
    expect(filtered.code, filtered.text).toBe(0);
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ numPassedTests: 0, numPendingTests: 1 });
    for (const invalid of ["not JSON", "{}", "[]", '["ok", 1]']) {
      writeFileSync(paths, invalid);
      expect((await run()).code, invalid).not.toBe(0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  // Two real Vitest startups plus four rejected invocations measured 2.0 s locally.
  // Allow 15x that startup cost under concurrent CI processes; this is a hang backstop.
}, 30_000);

it("subsets include dependencies, no-docker keeps Node parity and cannot stamp", () => {
  expect(names(["--only", "e2e"])).toEqual(["e2e-build", "preview-build", "internal-build", "locked-build", "e2e-1"]);
  expect(names(["--only", "size"])).toEqual(["build", "size"]);
  expect(plan(config(["--no-docker", "--only", "parity"])).flat()[0].args).toEqual(["parity", "--tier", "node"]);
  expect(canStamp(config())).toBe(true);
  for (const args of [["--no-docker"], ["--only", "unit"]]) expect(canStamp(config(args))).toBe(false);
  expect(canStamp(options(["quick"]))).toBe(false);
  for (const args of [
    ["--workers", "0"],
    ["--only", "unknown"],
    ["--linux", "--no-docker"],
  ])
    expect(() => config(args)).toThrow();
});

it("doctor recognizes the frozen pnpm 12 install", () => {
  expect(installed(process.cwd())).toBe(true);
});

it("doctor rejects dependencies removed from the manifest without a frozen reinstall", () => {
  mkdirSync("tests/.output", { recursive: true });
  const dir = mkdtempSync(resolve("tests/.output/gate-install-"));
  try {
    mkdirSync(join(dir, "node_modules/.pnpm"), { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "pnpm-lock.yaml"), readFileSync("pnpm-lock.yaml"));
    writeFileSync(join(dir, "node_modules/.pnpm/lock.yaml"), readFileSync("node_modules/.pnpm/lock.yaml"));
    expect(installed(dir)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("interrupts a queued gate without disturbing the holder", async () => {
  const key = `gate-unit-interrupt-${process.pid}`;
  const release = await acquireLock(key, process.platform, undefined, 0);
  const abort = new AbortController();
  let waiting!: () => void;
  const queued = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const contender = acquireLock(key, process.platform, waiting, release.port, abort.signal);
  try {
    await queued;
    abort.abort(new Error("interrupted"));
    await expect(contender).rejects.toThrow("interrupted");
  } finally {
    await release();
  }
});

it("fake orchestration retains failures and rejects a flaky zero-exit report", async () => {
  mkdirSync("tests/.output", { recursive: true });
  const dir = mkdtempSync(resolve("tests/.output/gate-unit-"));
  const calls: string[][] = [];
  const temps = new Set<string>();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await runSteps(
      process.cwd(),
      config(["--only", "e2e", "--repeat", "2", "--ports", "6480"]),
      [],
      dir,
      {},
      async (args: string[], { env }: { env: Record<string, string> }) => {
        calls.push(args);
        temps.add(env.TEMP);
        if (args.includes("playwright")) expect(env.TEMP).toBe(join(dir, "tmp"));
        else expect(env.TEMP).toMatch(/[\\/]tests[\\/]\.output[\\/]tmp[\\/]gate-/);
        expect(env.TMP).toBe(env.TEMP);
        expect(env.TMPDIR).toBe(env.TEMP);
        expect(env.E2E_CHROMIUM_ONLY).toBe("");
        if (args.includes("playwright"))
          writeFileSync(
            env.PLAYWRIGHT_JSON_OUTPUT_NAME,
            JSON.stringify({
              stats: {
                expected: 2,
                unexpected: 0,
                flaky: calls.filter((a) => a.includes("playwright")).length === 1 ? 1 : 0,
                skipped: 0,
              },
              errors: [],
            }),
          );
        return { code: 0, text: "" };
      },
    );
    expect(calls.filter((args) => args.includes("playwright"))).toHaveLength(2);
    expect(result.failures).toBe(1);
    for (const temp of temps) expect(existsSync(temp)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).reports).toHaveLength(2);
    const path = win32.join(
      "C:/" + "w".repeat(37),
      "tests/.output/g/r123456/e1/results",
      "t".repeat(100),
      "downloaded/out/Diagram (password protected) abcde.html",
    );
    expect(path.length).toBeLessThan(260);
  } finally {
    log.mockRestore();
    error.mockRestore();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("applies the capped worker count to Vitest as well as Playwright", async () => {
  mkdirSync("tests/.output", { recursive: true });
  const dir = mkdtempSync(resolve("tests/.output/gate-resources-"));
  const calls: string[][] = [];
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const result = await runSteps(
      process.cwd(),
      config(["--linux", "--cpus", "3", "--memory", "7g", "--only", "unit,e2e", "--ports", "6480"]),
      [],
      dir,
      { GATE_CONTAINER: "1" },
      async (args, { env }) => {
        calls.push(args);
        expect(existsSync(env.TEMP)).toBe(true);
        expect(env.TMP).toBe(env.TEMP);
        expect(env.TMPDIR).toBe(env.TEMP);
        if (args[0] === "test:coverage") {
          expect(args).toContain("--maxWorkers=1");
          writeFileSync(
            join(dir, "unit/results.json"),
            JSON.stringify({ success: true, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0 }),
          );
        }
        if (args.includes("playwright")) {
          expect(args).toContain("--workers=1");
          writeFileSync(
            env.PLAYWRIGHT_JSON_OUTPUT_NAME,
            JSON.stringify({ stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 } }),
          );
        }
        return { code: 0, text: "" };
      },
    );
    expect(result.workers).toBe(1);
    expect(result.failures).toBe(0);
    expect(calls.filter((args) => args[0] === "test:coverage")).toHaveLength(1);
    expect(calls.filter((args) => args.includes("playwright"))).toHaveLength(1);
  } finally {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
