// Splits the e2e spec files into CI shards of about equal measured duration. Playwright's `--shard` splits
// by test count in file order, so the slow specs bunched up and two shards ran about twice as long as the
// rest. Here each spec file goes whole to one shard (longest first, to the least loaded shard), and inside
// a shard `fullyParallel` spreads its tests over the workers.
//
// Durations come from tests/e2e-timings.json: seconds of test time per spec file, measured on CI. A spec
// file missing from it falls back to a deterministic file-count split. Refresh when summaries drift:
//   gh run download <run-id> -p 'e2e-durations-*' -D <dir>
//   node scripts/e2e-shard.mjs --update <dir>
//
// Usage:
//   node scripts/e2e-shard.mjs <current> <total>       the shard's spec files, for `playwright test <files>`
//   node scripts/e2e-shard.mjs --plan <total>          every shard's files and projected test time
//   node scripts/e2e-shard.mjs --update <report.json>  rewrite the timings from Playwright JSON reports
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";

const TEST_DIR = "tests/e2e";
const TIMINGS = "tests/e2e-timings.json";
// Playwright's default testMatch.
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

const fail = (message) => {
  console.error(`e2e-shard: ${message}`);
  process.exit(1);
};

/** Spec files relative to the test dir, with forward slashes (as Playwright's reports name them). */
function specFiles(root = process.cwd()) {
  return fs
    .readdirSync(path.join(root, TEST_DIR), { recursive: true })
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter((f) => SPEC.test(f))
    .sort();
}

function readTimings(root = process.cwd()) {
  if (!fs.existsSync(path.join(root, TIMINGS))) return {};
  try {
    const seconds = JSON.parse(fs.readFileSync(path.join(root, TIMINGS), "utf8"))?.seconds;
    return seconds && typeof seconds === "object" && !Array.isArray(seconds) ? seconds : {};
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.error("e2e-shard: invalid timing JSON; using a count split.");
    return {};
  }
}

/** Longest first, each to the least loaded shard (ties to the lower shard), so the result is stable. */
export function planShards(total, root = process.cwd()) {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error("Shard total must be a positive integer");
  const files = specFiles(root);
  // Empty shards must never fall back to running the whole Playwright suite.
  if (total > files.length) throw new Error("More shards than spec files; use fewer shards");
  const timings = readTimings(root);
  const unknown = files.filter((f) => !Number.isFinite(timings[f]) || timings[f] <= 0);
  if (unknown.length)
    console.error(
      `e2e-shard: missing/invalid timings for ${unknown.length} spec(s); using a count split. Refresh with --update.`,
    );
  const weight = (f) => (unknown.length ? 1 : timings[f]);
  const shards = Array.from({ length: total }, () => ({ files: [], seconds: 0 }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const target = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min), shards[0]);
    target.files.push(f);
    target.seconds += weight(f);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

export function shardFiles(current, total, root = process.cwd()) {
  if (!Number.isSafeInteger(current) || current < 1 || current > total)
    throw new Error("Shard index must be between 1 and total");
  return planShards(total, root)[current - 1].files.map((f) => path.posix.join(TEST_DIR, f));
}

export function updateTimings(reports, root = process.cwd()) {
  if (!reports.length) throw new Error("--update needs at least one Playwright JSON report.");
  // Accept a download directory on every shell, including PowerShell (which doesn't expand these globs).
  reports = reports.flatMap((file) => {
    if (!fs.statSync(file).isDirectory()) return [file];
    return fs
      .readdirSync(file, { recursive: true })
      .map((name) => path.join(file, name))
      .filter((name) => path.basename(name) === "results.json")
      .sort();
  });
  if (!reports.length) throw new Error("No Playwright results.json reports found");
  // Average each test's first attempt over the reports (retries are flakes, not the expected cost).
  const runs = new Map();
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests) {
        const first = t.results?.[0];
        if (!first || first.status !== "passed" || !Number.isFinite(first.duration) || first.duration < 0) continue;
        const key = [spec.file, t.projectName, ...titles, spec.title, spec.line].join("\u0000");
        const entry = runs.get(key) ?? { file: spec.file, ms: [] };
        entry.ms.push(first.duration);
        runs.set(key, entry);
      }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  for (const file of reports) for (const s of JSON.parse(fs.readFileSync(file, "utf8")).suites ?? []) walk(s, []);
  if (!runs.size) throw new Error("No successful first attempts in the timing reports");
  const measured = {};
  for (const { file, ms } of runs.values())
    measured[file] = (measured[file] ?? 0) + ms.reduce((a, b) => a + b, 0) / ms.length / 1000;
  // Spec files the reports didn't cover keep their old timing; deleted ones drop out.
  const old = readTimings(root);
  const seconds = {};
  for (const f of specFiles(root)) {
    const s = measured[f] ?? old[f];
    if (Number.isFinite(s) && s >= 0) seconds[f] = Math.max(0.1, Math.round(s * 10) / 10);
  }
  const about = "Seconds of test time per e2e spec file on CI, for scripts/e2e-shard.mjs. Regenerate, don't hand-edit.";
  fs.writeFileSync(path.join(root, TIMINGS), JSON.stringify({ about, seconds }, null, 2) + "\n");
  console.log(`e2e-shard: wrote ${Object.keys(seconds).length} spec timings from ${reports.length} report(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [a, b, ...rest] = process.argv.slice(2);
  try {
    if (a === "--update") updateTimings([b, ...rest].filter(Boolean));
    else if (a === "--plan") {
      const total = Number(b);
      if (!Number.isInteger(total) || total < 1) fail("usage: --plan <total>");
      for (const [i, s] of planShards(total).entries())
        console.log(`shard ${i + 1}: ${s.seconds.toFixed(0)} s, ${s.files.length} files: ${s.files.join(" ")}`);
    } else {
      const current = Number(a);
      const total = Number(b);
      if (!Number.isInteger(total) || total < 1 || !Number.isInteger(current) || current < 1 || current > total)
        fail("usage: <current> <total> (one-based)");
      console.log(shardFiles(current, total).join(" "));
    }
  } catch (error) {
    fail(error.message);
  }
}
