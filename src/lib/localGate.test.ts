import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, win32 } from "node:path";
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
    'status --porcelain --untracked-files=no') ;;
    *) return 9 ;;
  esac
}
pnpm() {
  echo "$*" >> "$GATE_PROBE_DIR/steps"
  if [ -n "\${GATE_PROBE_BARRIER:-}" ] && [ "$*" = '-s lint' ]; then node "$GATE_PROBE_BARRIER"; fi
  if [ "$GATE_PROBE_MODE" = unit ] && [ "$*" = '-s test' ]; then return 1; fi
}
npx() {
  local index="\${PLAYWRIGHT_JSON_OUTPUT_NAME%/results.json}"
  index="\${index##*/shard}"
  echo "$index" >> "$GATE_PROBE_DIR/shards"
  # Guard the runner settings too: CI-sized concurrency, production and no retries.
  case " $* " in *' --workers=3 --retries=0 '*) ;; *) return 9 ;; esac
  [ "$E2E_TARGET:$E2E_PORT:$E2E_LOCKED_PORT:$E2E_CHROMIUM_ONLY:$PLAYWRIGHT_HTML_OPEN" = 'build:6360:6364:1:never' ] || return 9
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
      },
    });
    expect(result.status, result.error?.message ?? result.stdout + result.stderr).toBe(probe.exit);
    expect(readFileSync(join(fixture, "shards"), "utf8").trim().split(/\r?\n/)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(readFileSync(join(fixture, "steps"), "utf8").trim().split(/\r?\n/)).toEqual(
      ["lint", "typecheck", "format:check", "test", "build", "size", "parity"].map((step) => `-s ${step}`),
    );
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
