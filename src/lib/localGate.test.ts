import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import process from "node:process";
import { expect, it, vi } from "vitest";
import {
  canStamp,
  checkTree,
  GIB,
  lockPort,
  options,
  plan,
  playwrightCounts,
  validatePorts,
  workerCount,
} from "../../scripts/gate/logic.mjs";
import { acquireLock, pickPorts, probePorts } from "../../scripts/gate/host.mjs";
import { browserTemp, runSteps } from "../../scripts/gate/run.mjs";
import { installed } from "../../scripts/gate/doctor.mjs";
import { pnpmCommand } from "../../scripts/gate/commands.mjs";

it("invokes standalone pnpm and JS shims without shell interpretation", () => {
  const args = ["exec", "tool", "a path with spaces", "$(literal)"];
  expect(pnpmCommand(args, process.execPath)).toEqual([process.execPath, args]);
  expect(pnpmCommand(args, "pnpm.cjs")).toEqual([process.execPath, ["pnpm.cjs", ...args]]);
});

const config = (args: string[] = []) => options(["full", ...args]);

it("keeps container browser profiles on the source volume and native profiles on the repo drive", () => {
  const root = resolve("tests/.output/volume-source");
  const report = join(root, "reports/run");
  expect(browserTemp(root, report, true)).toBe(join(root, "tests/.output/tmp"));
  expect(browserTemp(root, report)).toBe(join(report, "tmp"));
});
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
  [32, 12, 4],
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
  expect(steps.find((s: { name: string }) => s.name === "unit")?.args).toContain("related");
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
    rmSync(dir, { recursive: true, force: true });
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
        expect(env.TEMP).toBe(args.includes("playwright") ? join(dir, "tmp") : undefined);
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
    rmSync(dir, { recursive: true, force: true });
  }
});
