#!/usr/bin/env node
import process from "node:process";
import os from "node:os";
import console from "node:console";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { options, canStamp, checkTree, gitFiles, workerCount, resourceRequest } from "./gate/logic.mjs";
import { acquireBudget } from "./gate/budget.mjs";
import { git, cancelCommands } from "./gate/commands.mjs";
import { doctor, setup } from "./gate/doctor.mjs";
import { printSummary, runSteps } from "./gate/run.mjs";
import { linuxRun } from "./gate/linux.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Orchestrate the real gate; injectable host/command boundaries keep stamp tests isolated. */
export async function runGate(config, dependencies = {}, signal) {
  const {
    root: cwd = root,
    git: readGit = git,
    acquireBudget: reserve = acquireBudget,
    doctor: diagnose = doctor,
    runSteps: run = runSteps,
    linuxRun: linux = linuxRun,
    stampDir,
  } = dependencies;
  let release;
  try {
    const root = cwd;
    const common = realpathSync(resolve(root, await readGit(["rev-parse", "--git-common-dir"], root)));
    const capacity = workerCount(os.availableParallelism(), os.totalmem());
    const resources = resourceRequest(config, capacity);
    config = { ...config, workers: resources.workers, ...(config.linux ? { cpus: resources.cpus } : {}) };
    release = await reserve(
      join(os.tmpdir(), "livediagrams-gate-budget-v1"),
      {
        capacity,
        slots: resources.slots,
        ports: config.ports,
        worktree: root,
        branch: (await readGit(["branch", "--show-current"], root)) || "(detached HEAD)",
        command: `pnpm gate ${process.argv.slice(2).join(" ")}`,
      },
      { waiting: (message) => console.log(message), maxWait: config.maxWait, signal },
    );
    config.ports = release.ports;
    console.log(`Gate budget: ${resources.slots}/${capacity} workers/CPUs; ${config.workers} test workers`);
    const started = performance.now();
    const sha = await readGit(["rev-parse", "HEAD"], root);
    const stamp = join(stampDir ?? join(common, "verified"), sha);
    if (config.command === "full") {
      rmSync(stamp, { force: true });
      checkTree(await readGit(["status", "--porcelain", "--untracked-files=normal"], root), sha);
    }
    if (!config.docker)
      console.warn("WARNING: --no-docker skips Docker checks and browser parity. NO VERIFIED STAMP will be written.");
    if (!(await diagnose(root, config)))
      throw new Error("Doctor failed. Run pnpm gate setup or follow the fixes above.");
    console.log(`Ports: ${config.ports}–${config.ports + 4}`);
    let changed = [];
    if (config.command === "quick") {
      const base = await readGit(["merge-base", "HEAD", "origin/master"], root);
      const behind = Number(await readGit(["rev-list", "--count", "HEAD..origin/master"], root));
      if (behind)
        console.warn(`WARNING: branch is behind origin/master by ${behind} commits; run pnpm sync before pushing.`);
      changed = gitFiles(await readGit(["diff", "--name-only", "-z", "--diff-filter=ACMR", base], root));
      changed.push(...gitFiles(await readGit(["ls-files", "--others", "--exclude-standard", "-z"], root)));
      console.log(`Related files: ${changed.join(", ") || "none"}`);
    }
    const out = join(root, "tests/.output/g");
    mkdirSync(out, { recursive: true });
    const directory = mkdtempSync(join(out, "r"));
    console.log(`HEAD: ${sha}\nReports: ${directory}`);
    const summary = config.linux
      ? await linux(root, config, changed, directory, sha)
      : await run(root, config, changed, directory);
    try {
      if (config.command === "full")
        checkTree(
          await readGit(["status", "--porcelain", "--untracked-files=normal"], root),
          sha,
          await readGit(["rev-parse", "HEAD"], root),
        );
    } catch (error) {
      summary.failures++;
      console.error(error.message);
    }
    summary.totalSeconds = (performance.now() - started) / 1000;
    writeFileSync(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
    const line = printSummary(sha, summary);
    writeFileSync(join(directory, "summary.txt"), line + "\n");
    if (!summary.failures && canStamp(config)) {
      mkdirSync(dirname(stamp), { recursive: true });
      writeFileSync(stamp, `${line}\n${readFileSync(join(directory, "summary.json"), "utf8")}\n`);
      console.log(`Verified ${sha}. Stamp: ${stamp}`);
    } else console.log("No verification stamp (failed, subset or quick run).");
    return summary.failures ? 1 : 0;
  } finally {
    await release?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
    process.exitCode =
      config.command === "doctor" || config.command === "setup"
        ? (await (config.command === "setup" ? setup : doctor)(root, config))
          ? 0
          : 1
        : await runGate(config, {}, abort.signal);
  } catch (error) {
    console.error(`gate: ${error.message}`);
    process.exitCode = error.exitCode ?? 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
