#!/usr/bin/env node
import process from "node:process";
import console from "node:console";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { options, canStamp, checkTree } from "./gate/logic.mjs";
import { acquireLock, pickPorts, probePorts } from "./gate/host.mjs";
import { git, cancelCommands } from "./gate/commands.mjs";
import { doctor, setup } from "./gate/doctor.mjs";
import { printSummary, runSteps } from "./gate/run.mjs";
import { linuxRun } from "./gate/linux.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let release;
const abort = new globalThis.AbortController();
const interrupt = () => {
  abort.abort(new Error("Gate interrupted"));
  console.error("Gate interrupted; stopping its commands and servers…");
  void cancelCommands();
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  const config = options(process.argv.slice(2));
  if (config.command === "doctor" || config.command === "setup") {
    process.exitCode = (await (config.command === "setup" ? setup : doctor)(root, config)) ? 0 : 1;
  } else {
    const common = realpathSync(resolve(root, await git(["rev-parse", "--git-common-dir"], root)));
    release = await acquireLock(
      common,
      process.platform,
      () => console.log("Waiting for another full local gate…"),
      undefined,
      abort.signal,
    );
    const started = performance.now();
    const sha = await git(["rev-parse", "HEAD"], root);
    const stamp = join(common, "verified", sha);
    if (config.command === "full") {
      rmSync(stamp, { force: true });
      checkTree(await git(["status", "--porcelain", "--untracked-files=normal"], root), sha);
    }
    if (!config.docker)
      console.warn("WARNING: --no-docker skips Docker checks and browser parity. NO VERIFIED STAMP will be written.");
    if (!(await doctor(root, config))) throw new Error("Doctor failed. Run pnpm gate setup or follow the fixes above.");
    config.ports = config.ports ? await probePorts(config.ports) : await pickPorts();
    console.log(`Ports: ${config.ports}–${config.ports + 4}`);
    let changed = [];
    if (config.command === "quick") {
      const base = await git(["merge-base", "HEAD", "origin/master"], root);
      const behind = Number(await git(["rev-list", "--count", "HEAD..origin/master"], root));
      if (behind)
        console.warn(`WARNING: branch is behind origin/master by ${behind} commits; rebase before the full gate.`);
      changed = (await git(["diff", "--name-only", "--diff-filter=ACMR", base], root)).split(/\r?\n/).filter(Boolean);
      changed.push(...(await git(["ls-files", "--others", "--exclude-standard"], root)).split(/\r?\n/).filter(Boolean));
      console.log(`Related files: ${changed.join(", ") || "none"}`);
    }
    const out = join(root, "tests/.output/g");
    mkdirSync(out, { recursive: true });
    const directory = mkdtempSync(join(out, "r"));
    console.log(`HEAD: ${sha}\nReports: ${directory}`);
    const summary = config.linux
      ? await linuxRun(root, config, changed, directory, sha)
      : await runSteps(root, config, changed, directory);
    try {
      if (config.command === "full")
        checkTree(
          await git(["status", "--porcelain", "--untracked-files=normal"], root),
          sha,
          await git(["rev-parse", "HEAD"], root),
        );
    } catch (error) {
      summary.failures++;
      console.error(error.message);
    }
    summary.totalSeconds = (performance.now() - started) / 1000;
    writeFileSync(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
    const line = printSummary(sha, summary);
    writeFileSync(join(directory, "summary.txt"), line + "\n");
    if (summary.failures) process.exitCode = 1;
    else if (canStamp(config)) {
      mkdirSync(dirname(stamp), { recursive: true });
      writeFileSync(stamp, `${line}\n${readFileSync(join(directory, "summary.json"), "utf8")}\n`);
      console.log(`Verified ${sha}. Stamp: ${stamp}`);
    } else console.log("Subset/quick run complete; no verification stamp.");
  }
} catch (error) {
  console.error(`gate: ${error.message}`);
  process.exitCode = 1;
} finally {
  await release?.();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
