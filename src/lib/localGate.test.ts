import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, win32 } from "node:path";
import { createServer, type Server } from "node:net";
import process from "node:process";
import { expect, it } from "vitest";

// Run the real Bash orchestration with fake commands: no browsers, builds, commits or servers.
// Functions in BASH_ENV also work on Git Bash, without Windows .cmd/PATH quoting differences.
const commands = `
git() {
  case "$*" in
    'rev-parse --show-toplevel') pwd ;;
    'rev-parse HEAD') printf '%040d\\n' 1 ;;
    'rev-parse --git-common-dir') echo "$GATE_PROBE_DIR/git" ;;
    'status --porcelain --untracked-files='*)
      if [ -n "\${GATE_PROBE_TREE:-}" ]; then command git -C "$GATE_PROBE_TREE" "$@"; return; fi
      if [ "$GATE_PROBE_MODE" = untracked ] && [ "$*" != 'status --porcelain --untracked-files=no' ]; then echo '?? src/helper.ts'; fi
      if [ "$GATE_PROBE_MODE" = late-untracked ] && [ -f "$GATE_PROBE_DIR/shards" ] && [ "$*" != 'status --porcelain --untracked-files=no' ]; then echo '?? src/helper.ts'; fi
      ;;
    *) return 9 ;;
  esac
}
pnpm() {
  echo "$*" >> "$GATE_PROBE_DIR/steps"
  if [ -n "\${GATE_PROBE_BARRIER:-}" ] && [ "$*" = '-s lint' ]; then node "$GATE_PROBE_BARRIER"; fi
  if [ "$GATE_PROBE_MODE" = unit ] && [[ "$*" == '-s test'* ]]; then return 1; fi
  if [ "$GATE_PROBE_MODE" = focused-unit ] && [[ "$*" == '-s test'*'--allowOnly=false'* ]]; then return 1; fi
  if [[ "$*" == 'exec vite build'* ]]; then
    [ "$VITE_E2E:\${E2E_PREBUILT:-}" = '1:' ] || return 9
    if [ "$GATE_PROBE_MODE" = build ]; then return 1; fi
  fi
}
npx() {
  local index="\${PLAYWRIGHT_JSON_OUTPUT_NAME%/results.json}"
  index="\${index##*/shard}"
  echo "$index" >> "$GATE_PROBE_DIR/shards"
  # Guard the runner settings too: CI-sized concurrency, production and no retries.
  case " $* " in *' --workers=3 --retries=0 '*) ;; *) return 9 ;; esac
  [ "$E2E_TARGET:$E2E_PORT:$E2E_LOCKED_PORT:$E2E_CHROMIUM_ONLY:$PLAYWRIGHT_HTML_OPEN:\${E2E_GATE:-}:\${E2E_PREBUILT:-}" = 'build:6360:6364:1:never:1:1' ] || return 9
  if [ "$GATE_PROBE_MODE" = focused-e2e ]; then
    case " $* " in *' --forbid-only '*) return 1 ;; esac
  fi
  local passed=2 failed=0 flaky=0 code=0
  if [ "$index" = 3 ]; then
    case "$GATE_PROBE_MODE" in
      missing) return 1 ;;
      shard) passed=1; failed=1; code=1 ;;
      flaky) passed=1; flaky=1 ;; # Even a zero process exit cannot authorize a flake.
    esac
  fi
  printf '{"stats":{"expected":%s,"unexpected":%s,"flaky":%s,"skipped":0},"errors":[]}\n' "$passed" "$failed" "$flaky" > "$PLAYWRIGHT_JSON_OUTPUT_NAME"
  return "$code"
}
`;

it.each([
  { mode: "success", exit: 0, totals: "passed=12 failed=0 flaky=0 skipped=0 gate_failures=0" },
  { mode: "shard", exit: 1, totals: "passed=11 failed=1 flaky=0 skipped=0 gate_failures=1" },
  { mode: "flaky", exit: 1, totals: "passed=11 failed=0 flaky=1 skipped=0 gate_failures=1" },
  { mode: "missing", exit: 1, totals: "passed=10 failed=0 flaky=0 skipped=0 gate_failures=1" },
  { mode: "unit", exit: 1, totals: "passed=12 failed=0 flaky=0 skipped=0 gate_failures=1" },
  { mode: "focused-unit", exit: 1, totals: "passed=12 failed=0 flaky=0 skipped=0 gate_failures=1" },
  { mode: "focused-e2e", exit: 1, totals: "passed=0 failed=0 flaky=0 skipped=0 gate_failures=6" },
  { mode: "late-untracked", exit: 1, totals: "passed=12 failed=0 flaky=0 skipped=0 gate_failures=1" },
])("the local gate collects every shard and stamps only a complete success ($mode)", { timeout: 40_000 }, (probe) => {
  const output = resolve("tests/.output");
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(join(output, "gate-probe-"));
  const sha = "1".padStart(40, "0");
  const stamp = join(fixture, "git/verified", sha);
  mkdirSync(join(fixture, "git/verified"), { recursive: true });
  writeFileSync(stamp, "stale success");
  const envFile = join(fixture, "commands.sh");
  writeFileSync(envFile, commands);
  try {
    const result = spawnSync("bash", ["scripts/verify-push.sh", "6360"], {
      encoding: "utf8",
      timeout: 40_000,
      env: {
        ...process.env,
        BASH_ENV: envFile.replaceAll("\\", "/"),
        GATE_PROBE_DIR: relative(process.cwd(), fixture).replaceAll("\\", "/"),
        GATE_PROBE_MODE: probe.mode,
        E2E_PREBUILT: "1", // A caller's stale bundle must never skip the fresh build.
      },
    });
    expect(result.status, result.error?.message ?? result.stdout + result.stderr).toBe(probe.exit);
    expect(readFileSync(join(fixture, "shards"), "utf8").trim().split(/\r?\n/)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(readFileSync(join(fixture, "steps"), "utf8").trim().split(/\r?\n/)).toEqual([
      ...["lint", "typecheck", "format:check", "test --allowOnly=false", "build", "size", "parity"].map(
        (step) => `-s ${step}`,
      ),
      "exec vite build --outDir tests/.output/e2e-dist --emptyOutDir --logLevel error",
    ]);
    expect(result.stdout).toContain(`SUMMARY: ${sha} | shards=6 ${probe.totals}`);
    const log = /^Log: (.+)$/m.exec(result.stdout)?.[1].trim();
    if (!log) throw new Error("Missing gate log path");
    // A typical checkout root, Playwright's long per-test directory, and a nested
    // offline export must fit Chrome's Windows file:// limit on every test host.
    const offlineFile = win32.join(
      "C:/" + "w".repeat(37),
      relative(process.cwd(), dirname(resolve(log))),
      "shard4/results",
      "t".repeat(100),
      "downloaded/out/Diagram (password protected) abcde.html",
    );
    expect(offlineFile.length).toBeLessThan(260);
    expect(existsSync(stamp)).toBe(probe.exit === 0);
    if (probe.exit === 0) expect(readFileSync(stamp, "utf8")).toContain(probe.totals);
  } finally {
    // mkdtemp's absolute target is inside the chosen workspace output directory.
    rmSync(fixture, { recursive: true, force: true });
  }
});

function gateProbe(mode: string, base = 6360) {
  const output = resolve("tests/.output");
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(join(output, "gate-preflight-"));
  const stamp = join(fixture, "git/verified", "1".padStart(40, "0"));
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, "stale success");
  const envFile = join(fixture, "commands.sh");
  writeFileSync(envFile, commands);
  return {
    fixture,
    stamp,
    run(extra: Record<string, string> = {}) {
      const child = spawn("bash", ["scripts/verify-push.sh", String(base)], {
        env: {
          ...process.env,
          BASH_ENV: envFile.replaceAll("\\", "/"),
          GATE_PROBE_DIR: relative(process.cwd(), fixture).replaceAll("\\", "/"),
          GATE_PROBE_MODE: mode,
          ...extra,
        },
      });
      return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      });
    },
    cleanup: () => rmSync(fixture, { recursive: true, force: true }),
  };
}

// An ephemeral port says nothing about its neighbours. Reserve the whole range on both
// address families, then release every listener except the intended occupied port.

const close = async (server: Server) => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};
const listen = (server: Server, port: number, host: string) =>
  new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host, exclusive: true, ipv6Only: host === "::1" }, () => {
      server.off("error", reject);
      resolve();
    });
  });
const codeOf = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

async function occupiedRange(offset: number, firstBase = 0) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const servers: Server[] = [];
    let kept: Server | undefined;
    const open = async (port: number, host: string) => {
      const server = createServer();
      servers.push(server);
      await listen(server, port, host);
      return server;
    };
    try {
      const first = await open(attempt === 0 ? firstBase : 0, "127.0.0.1");
      const address = first.address();
      if (!address || typeof address === "string") throw new Error("Missing probe port");
      const base = address.port;
      if (base > 65531 || [5190, 6000].some((port) => base <= port && port <= base + 4)) continue;
      const ipv4 = [first];
      for (let i = 1; i < 5; i++) ipv4.push(await open(base + i, "127.0.0.1"));
      for (let i = 0; i < 5; i++) {
        try {
          await open(base + i, "::1");
        } catch (error) {
          if (codeOf(error) !== "EAFNOSUPPORT" && codeOf(error) !== "EADDRNOTAVAIL") throw error;
        }
      }
      const target = ipv4[offset];
      await Promise.all(servers.filter((server) => server !== target).map(close));
      kept = target;
      return { base, port: base + offset, close: () => close(target) };
    } catch (error) {
      if (codeOf(error) !== "EACCES" && codeOf(error) !== "EADDRINUSE") throw error;
    } finally {
      await Promise.all(servers.filter((server) => server !== kept).map(close));
    }
  }
  throw new Error("Could not reserve a complete five-port probe range");
}

it("occupied-port fixtures skip a range with an unavailable earlier sibling", { timeout: 40_000 }, async () => {
  const blocked = await occupiedRange(2);
  let occupied: Awaited<ReturnType<typeof occupiedRange>> | undefined;
  let probe: ReturnType<typeof gateProbe> | undefined;
  try {
    occupied = await occupiedRange(4, blocked.base);
    expect(occupied.base).not.toBe(blocked.base);
    probe = gateProbe("success", occupied.base);
    const result = await probe.run();
    expect(result.code, result.output).toBe(2);
    expect(result.output).toContain(`port ${occupied.port} on 127.0.0.1 is unavailable`);
    expect(existsSync(join(probe.fixture, "steps"))).toBe(false);
    expect(existsSync(join(probe.fixture, "shards"))).toBe(false);
    expect(existsSync(probe.stamp)).toBe(false);
  } finally {
    await Promise.all([blocked.close(), occupied?.close()]);
    probe?.cleanup();
  }
});

it.each([0, 1, 2, 3, 4])(
  "gate mode rejects an occupied port at offset %s before checks",
  { timeout: 40_000 },
  async (offset) => {
    const occupied = await occupiedRange(offset);
    const probe = gateProbe("success", occupied.base);
    try {
      const result = await probe.run();
      expect(result.code, result.output).toBe(2);
      expect(result.output).toContain(`port ${occupied.port} on 127.0.0.1 is unavailable`);
      expect(existsSync(join(probe.fixture, "steps"))).toBe(false);
      expect(existsSync(join(probe.fixture, "shards"))).toBe(false);
      expect(existsSync(probe.stamp)).toBe(false);
    } finally {
      await occupied.close();
      probe.cleanup();
    }
  },
);

it("rejects nonignored untracked files but permits gitignored files", { timeout: 40_000 }, async () => {
  const probe = gateProbe("success");
  const tree = join(probe.fixture, "tree");
  mkdirSync(tree);
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", tree, ...args], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    git("init", "--quiet");
    writeFileSync(join(tree, ".git/info/exclude"), "ignored.txt\n");
    writeFileSync(join(tree, "ignored.txt"), "local ignored data");
    writeFileSync(join(tree, "helper.ts"), "export const helper = 1;\n");
    const env = { GATE_PROBE_TREE: tree.replaceAll("\\", "/") };
    const dirty = await probe.run(env);
    expect(dirty.code, dirty.output).toBe(2);
    expect(dirty.output).toContain("nonignored untracked changes");
    expect(existsSync(join(probe.fixture, "steps"))).toBe(false);
    expect(existsSync(probe.stamp)).toBe(false);
    rmSync(join(tree, "helper.ts"));
    const clean = await probe.run(env);
    expect(clean.code, clean.output).toBe(0);
    expect(existsSync(probe.stamp)).toBe(true);
  } finally {
    probe.cleanup();
  }
});

it("does not run shards or stamp HEAD after the fresh E2E build fails", { timeout: 40_000 }, async () => {
  const probe = gateProbe("build");
  try {
    const result = await probe.run({ E2E_PREBUILT: "1" });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain("shards=0 passed=0 failed=0 flaky=0 skipped=0 gate_failures=1");
    expect(result.output).toContain("Skipping e2e shards");
    expect(existsSync(join(probe.fixture, "shards"))).toBe(false);
    expect(existsSync(probe.stamp)).toBe(false);
  } finally {
    probe.cleanup();
  }
});

it.each(["vitest", "playwright"])(
  "%s rejects focused tests with the gate's CLI policy",
  { timeout: 40_000 },
  (runner) => {
    const output = resolve("tests/.output");
    mkdirSync(output, { recursive: true });
    const fixture = mkdtempSync(join(output, "gate-focused-"));
    const spec = join(fixture, runner === "vitest" ? "focused.test.ts" : "focused.spec.ts");
    const config = join(fixture, "config.mjs");
    writeFileSync(
      spec,
      `import { ${runner === "vitest" ? "it as test" : "test"} } from "${runner === "vitest" ? "vitest" : "@playwright/test"}";\ntest.only("focused", () => {});\n`,
    );
    writeFileSync(
      config,
      runner === "vitest"
        ? `export default { test: { include: [${JSON.stringify(spec.replaceAll("\\", "/"))}] } };\n`
        : `export default { testDir: ${JSON.stringify(fixture.replaceAll("\\", "/"))}, outputDir: ${JSON.stringify(join(fixture, "results").replaceAll("\\", "/"))} };\n`,
    );
    try {
      // Paths are argv, never interpolated into shell source.
      const result = spawnSync(
        "bash",
        [
          "-c",
          'pnpm exec "$@"',
          "gate-focused",
          runner,
          runner === "vitest" ? "run" : "test",
          "--config",
          config.replaceAll("\\", "/"),
          runner === "vitest" ? "--allowOnly=false" : "--forbid-only",
        ],
        {
          encoding: "utf8",
          timeout: 40_000,
        },
      );
      expect(result.status, result.error?.message ?? result.stdout + result.stderr).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/\.only/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

it("queues gates sharing Git metadata and releases the lock after a failure", { timeout: 40_000 }, async () => {
  const output = resolve("tests/.output");
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(join(output, "gate-queue-"));
  const envFile = join(fixture, "commands.sh");
  writeFileSync(envFile, commands);
  const barrier = join(fixture, "barrier.cjs");
  writeFileSync(
    barrier,
    `const fs = require("node:fs"), path = require("node:path");
const root = process.env.GATE_PROBE_DIR, id = process.env.GATE_PROBE_INSTANCE;
const release = path.join(root, "release");
fs.appendFileSync(path.join(root, "events"), id + " enter\\n");
fs.writeFileSync(path.join(root, id + "-entered"), "");
let left = false;
const leave = () => {
  if (left) return;
  left = true;
  fs.appendFileSync(path.join(root, "events"), id + " leave\\n");
};
if (id === "one" && !fs.existsSync(release)) {
  const watcher = fs.watch(root, () => {
    if (fs.existsSync(release)) { watcher.close(); leave(); }
  });
  if (fs.existsSync(release)) { watcher.close(); leave(); }
} else leave();
`,
  );
  const arrivals = ["one", "two"].map((id) => {
    let close = () => {};
    const ready = new Promise<void>((done) => {
      const observe = watch(fixture, () => {
        if (existsSync(join(fixture, id + "-entered"))) {
          observe.close();
          done();
        }
      });
      close = () => observe.close();
    });
    return { ready, close };
  });
  const start = (id: string, mode: string) => {
    const child = spawn("bash", ["scripts/verify-push.sh", "6360"], {
      env: {
        ...process.env,
        BASH_ENV: envFile.replaceAll("\\", "/"),
        LD_GATE_REENTRY: "",
        GATE_PROBE_DIR: relative(process.cwd(), fixture).replaceAll("\\", "/"),
        GATE_PROBE_MODE: mode,
        GATE_PROBE_INSTANCE: id,
        GATE_PROBE_BARRIER: barrier.replaceAll("\\", "/"),
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    const done = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    const waiting = new Promise<"waiting">((resolve) => {
      child.stdout.on("data", () => {
        if (out.includes("Waiting for another full local gate")) resolve("waiting");
      });
    });
    return { done, waiting, output: () => out + err };
  };
  const gates: ReturnType<typeof start>[] = [];
  try {
    const first = start("one", "unit");
    gates.push(first);
    await Promise.race([
      arrivals[0].ready,
      first.done.then(() => {
        throw new Error(`First gate exited before its barrier: ${first.output()}`);
      }),
    ]);
    const second = start("two", "success");
    gates.push(second);
    const observed = await Promise.race([
      second.waiting,
      arrivals[1].ready.then(() => "overlapped"),
      second.done.then(() => `exited: ${second.output()}`),
    ]);
    expect(observed).toBe("waiting");
    expect(existsSync(join(fixture, "two-entered"))).toBe(false);
    writeFileSync(join(fixture, "release"), "");
    expect(await Promise.all(gates.map((gate) => gate.done)), gates.map((gate) => gate.output()).join("\n")).toEqual([
      1, 0,
    ]);
    expect(readFileSync(join(fixture, "events"), "utf8").trim().split(/\r?\n/)).toEqual([
      "one enter",
      "one leave",
      "two enter",
      "two leave",
    ]);
  } finally {
    writeFileSync(join(fixture, "release"), "");
    await Promise.allSettled(gates.map((gate) => gate.done));
    arrivals.forEach((arrival) => arrival.close());
    rmSync(fixture, { recursive: true, force: true });
  }
});
