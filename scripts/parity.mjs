#!/usr/bin/env node
// The output-parity harness (docs/PARITY.md): runs the Node tier (Vitest) and the browser tier (Playwright on a
// production build), then summarises every golden compared, changed, added or missing, and finds stale goldens
// (files nothing produced any more).
//
//   node scripts/parity.mjs                 check both tiers (CI)
//   node scripts/parity.mjs --tier node     one tier (node | browser | all)
//   node scripts/parity.mjs --update        re-record the goldens and print what changed (refused on CI)
//   node scripts/parity.mjs sim checks      only parity files matching these filters (no stale check)
//
// The browser tier runs in the pinned Linux image Playwright publishes for its version
// (mcr.microsoft.com/playwright:v<version>-noble), through Docker, wherever this runs: text measures differently
// on each operating system, so goldens made on one wouldn't match another. Inside the image, it runs directly.
// PARITY_BROWSER_HOST=1 runs it on this machine instead (to debug; expect differences off Linux).
// PARITY_PREBUILT=1 serves tests/.output/parity-dist as it is (skips the production build).
// PARITY_PORT picks the preview server's port (default 6200).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import console from "node:console";
import process from "node:process";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GOLDENS = join(ROOT, "tests/parity/goldens");
const OUTPUT = join(ROOT, "tests/.output/parity");
const DIST = "tests/.output/parity-dist";
/** Set inside the browser tier's container (below). */
const IN_CONTAINER = process.env.PARITY_CONTAINER === "1";

const args = process.argv.slice(2);
const update = args.includes("--update");
/** Inside the container: run the browser tier only; the caller cleans, summarises and checks staleness. */
const inner = args.includes("--inner");
const tierAt = args.indexOf("--tier");
const tierArg = tierAt >= 0 ? args[tierAt + 1] : "all";
const filters = args.filter((a, i) => !a.startsWith("--") && !(tierAt >= 0 && i === tierAt + 1));
if (!["node", "browser", "all"].includes(tierArg)) fail(`--tier must be node, browser or all, not "${tierArg}"`);
if (update && process.env.CI) fail("pnpm parity:update is refused on CI: goldens are updated on purpose, locally.");
/** A tier's parity files, as repository paths (what Vitest and Playwright match a filter against). */
function tierFiles(tier) {
  const dir = join(ROOT, "tests/parity", tier);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".parity.ts"))
        .map((f) => `tests/parity/${tier}/${f}`)
    : [];
}
// With filters, only the tiers that have a matching file run (Playwright fails when nothing matches); a filter that
// matches nothing at all is an error.
const matches = (tier) => !filters.length || tierFiles(tier).some((f) => filters.some((x) => f.includes(x)));
const requested = inner ? ["browser"] : tierArg === "all" ? ["node", "browser"] : [tierArg];
const tiers = requested.filter(matches);
if (!tiers.length) fail(`no parity file under tests/parity/{${requested.join(",")}} matches ${filters.join(", ")}`);

function fail(message) {
  console.error(`parity: ${message}`);
  process.exit(2);
}

function run(command, commandArgs, env = {}, shell = process.platform === "win32") {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell,
    env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true", ...env },
  });
  if (result.error) console.error(`parity: ${result.error.message}`);
  return result.status === 0;
}

const env = update ? { PARITY_UPDATE: "1" } : {};

/** The browser tier, here: a production build, then Playwright against it. */
function browserHere() {
  let built = true;
  if (process.env.PARITY_PREBUILT !== "1")
    built = run("pnpm", ["exec", "vite", "build", "--outDir", DIST, "--emptyOutDir", "--logLevel", "error"], {
      VITE_E2E: "",
    });
  return (
    built &&
    run("pnpm", ["exec", "playwright", "test", "--config", "tests/parity/playwright.config.ts", ...filters], env)
  );
}

/** The browser tier in Playwright's Linux image for the installed version, with this checkout mounted. */
function browserInContainer() {
  const pkg = join(ROOT, "node_modules/@playwright/test/package.json");
  if (!existsSync(pkg)) fail("install the dependencies first (pnpm install)");
  const version = JSON.parse(readFileSync(pkg, "utf8")).version;
  const packageManager = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).packageManager;
  const image = `mcr.microsoft.com/playwright:v${version}-noble`;
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" }).status !== 0)
    fail(
      `the browser tier runs in ${image} and needs Docker (running). Start Docker, or run \`pnpm parity:node\` ` +
        "for the Node tier alone.",
    );
  const owner = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : "";
  const inside = [
    "set -e",
    `corepack enable >/dev/null 2>&1 || npm install -g ${packageManager} >/dev/null`,
    "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    "pnpm install --frozen-lockfile --prefer-offline --reporter=silent",
    "status=0",
    `node scripts/parity.mjs --inner${update ? " --update" : ""} ${filters.map((f) => `'${f.replace(/'/g, "")}'`).join(" ")} || status=$?`,
    // Files written in the mount belong to the caller, not to the container's root.
    owner ? `chown -R ${owner} tests/.output tests/parity/goldens 2>/dev/null || true` : "true",
    "exit $status",
  ].join("\n");
  return run(
    "docker",
    [
      "run",
      "--rm",
      "--ipc=host",
      "-v",
      `${ROOT}:/work`,
      // Linux's node_modules, kept between runs, one volume per checkout (two checkouts may run at once with different
      // lockfiles); the pnpm store, content-addressed, is shared.
      "-v",
      `livediagrams-parity-node-modules-${createHash("sha256").update(ROOT).digest("hex").slice(0, 12)}:/work/node_modules`,
      // Outside the mount: pnpm would otherwise put its store beside the checkout (.pnpm-store).
      "-v",
      "livediagrams-parity-pnpm-store:/pnpm-store",
      "-e",
      "pnpm_config_store_dir=/pnpm-store",
      "-e",
      "npm_config_engine_strict=false",
      "-w",
      "/work",
      "-e",
      "PARITY_CONTAINER=1",
      ...["CI", "GITHUB_ACTIONS", "PARITY_PORT", "PARITY_PREBUILT", "PARITY_CPU_THROTTLE", "PARITY_WORKERS"].flatMap(
        (k) => (process.env[k] ? ["-e", `${k}=${process.env[k]}`] : []),
      ),
      image,
      "bash",
      "-c",
      inside,
    ],
    {},
    false,
  );
}

if (!inner) rmSync(OUTPUT, { recursive: true, force: true });
const ran = {};
for (const tier of tiers) {
  if (tier === "node")
    ran.node = run("pnpm", ["exec", "vitest", "run", "--config", "tests/parity/vitest.config.ts", ...filters], env);
  else ran.browser = IN_CONTAINER || process.env.PARITY_BROWSER_HOST === "1" ? browserHere() : browserInContainer();
}
if (inner) process.exit(ran.browser ? 0 : 1);

// ------------------------------------------------------------------------------------------------- summary

/** @type {{name: string, status: string, total?: number, lines?: string[]}[]} */
const ledger = [];
const ledgerDir = join(OUTPUT, "ledger");
if (existsSync(ledgerDir))
  for (const file of readdirSync(ledgerDir).sort())
    for (const line of readFileSync(join(ledgerDir, file), "utf8").split("\n"))
      if (line.trim()) ledger.push(JSON.parse(line));

const names = new Map();
for (const entry of ledger) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
const twice = [...names].filter(([, n]) => n > 1).map(([name]) => name);

/** Files under `dir`, as paths relative to `base` with forward slashes. */
function walk(dir, base = GOLDENS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full).split(sep).join("/")];
  });
}

// Stale goldens: only after a whole tier ran (a filter runs part of it), and only for a tier that ran at all
// (a crash before any golden would otherwise call every golden stale).
const stale = [];
if (!filters.length)
  for (const tier of tiers) {
    const produced = ledger.filter((e) => e.name.startsWith(`${tier}/`));
    if (!produced.length || !ran[tier]) continue;
    for (const file of walk(join(GOLDENS, tier))) if (!names.has(file)) stale.push(file);
  }
if (update)
  for (const file of stale) {
    rmSync(join(GOLDENS, file));
    // Leave no empty directories behind.
    for (let dir = join(GOLDENS, file, ".."); dir.startsWith(GOLDENS) && dir !== GOLDENS; dir = join(dir, "..")) {
      if (readdirSync(dir).length) break;
      rmSync(dir, { recursive: true });
    }
  }

const by = (status) => ledger.filter((e) => e.status === status);
const changed = by("changed");
const added = by("added");
const missing = by("missing");
const out = [];
out.push(
  `Parity${update ? " (update)" : ""}: ${ledger.length} goldens, ${changed.length} changed, ${added.length} added, ` +
    `${missing.length} missing, ${stale.length} ${update ? "removed" : "stale"}`,
);
for (const e of changed)
  out.push(`  changed  ${e.name}  (${e.total})  ${(e.lines ?? []).slice(0, update ? 2 : 1).join("  ")}`);
for (const e of added) out.push(`  added    ${e.name}`);
for (const e of missing) out.push(`  missing  ${e.name}`);
for (const name of stale) out.push(`  ${update ? "removed" : "stale"}  ${name}`);
for (const name of twice) out.push(`  recorded twice: ${name}`);
for (const [tier, ok] of Object.entries(ran)) if (!ok) out.push(`  the ${tier} tier failed (see its output above)`);
console.log(`\n${out.join("\n")}`);

const ok =
  Object.values(ran).every(Boolean) &&
  !twice.length &&
  (update || (!stale.length && !changed.length && !missing.length));
if (!update && !ok)
  console.log("\nIf these changes are intended, run `pnpm parity:update` and commit the goldens with them.");

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [`### ${ok ? "Output parity holds" : "Output parity failed"}`, "", "```", ...out, "```"];
  const diffs = join(OUTPUT, "diffs");
  for (const file of walk(diffs, diffs).slice(0, 20))
    md.push(
      "",
      `<details><summary>${file}</summary>`,
      "",
      "```diff",
      readFileSync(join(diffs, file), "utf8"),
      "```",
      "</details>",
    );
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
}
process.exit(ok ? 0 : 1);
