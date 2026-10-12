// Splits the e2e spec files into CI shards of about equal measured duration. Playwright's `--shard` splits
// by test count in file order, so the slow specs bunched up and two shards ran about twice as long as the
// rest. Here each spec file goes whole to one shard (longest first, to the least loaded shard), and inside
// a shard `fullyParallel` spreads its tests over the workers.
//
// Durations come from tests/e2e-timings.json: seconds of test time per spec file, measured on CI. A spec
// file missing from it counts as an average one. Refresh it when the job summaries drift:
//   gh run download <run-id> -p 'e2e-durations-*' -D <dir>
//   node scripts/e2e-shard.mjs --update <dir>/*/results.json
//
// Usage:
//   node scripts/e2e-shard.mjs <current> <total>       the shard's spec files, for `playwright test <files>`
//   node scripts/e2e-shard.mjs --plan <total>          every shard's files and projected test time
//   node scripts/e2e-shard.mjs --update <report.json>  rewrite the timings from Playwright JSON reports
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const TEST_DIR = "tests/e2e";
const TIMINGS = "tests/e2e-timings.json";
// Playwright's default testMatch.
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

const fail = (message) => {
  console.error(`e2e-shard: ${message}`);
  process.exit(1);
};

/** Spec files relative to the test dir, with forward slashes (as Playwright's reports name them). */
function specFiles() {
  return fs
    .readdirSync(TEST_DIR, { recursive: true })
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter((f) => SPEC.test(f))
    .sort();
}

function readTimings() {
  if (!fs.existsSync(TIMINGS)) return {};
  return JSON.parse(fs.readFileSync(TIMINGS, "utf8")).seconds ?? {};
}

/** Longest first, each to the least loaded shard (ties to the lower shard), so the result is stable. */
function plan(total) {
  const files = specFiles();
  const timings = readTimings();
  const known = files.filter((f) => timings[f] !== undefined).map((f) => timings[f]);
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const unknown = files.filter((f) => timings[f] === undefined);
  if (unknown.length)
    console.error(`e2e-shard: no timing for ${unknown.join(", ")}; counted as ${average.toFixed(0)} s each.`);
  const weight = (f) => timings[f] ?? average;
  const shards = Array.from({ length: total }, () => ({ files: [], seconds: 0 }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const target = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min), shards[0]);
    target.files.push(f);
    target.seconds += weight(f);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function update(reports) {
  if (!reports.length) fail("--update needs at least one Playwright JSON report.");
  // Average each test's first attempt over the reports (retries are flakes, not the expected cost).
  const runs = new Map();
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests) {
        const first = t.results?.[0];
        if (!first || first.status === "skipped") continue;
        const key = [spec.file, t.projectName, ...titles, spec.title, spec.line].join("\u0000");
        const entry = runs.get(key) ?? { file: spec.file, ms: [] };
        entry.ms.push(first.duration);
        runs.set(key, entry);
      }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  for (const file of reports) for (const s of JSON.parse(fs.readFileSync(file, "utf8")).suites ?? []) walk(s, []);
  const measured = {};
  for (const { file, ms } of runs.values())
    measured[file] = (measured[file] ?? 0) + ms.reduce((a, b) => a + b, 0) / ms.length / 1000;
  // Spec files the reports didn't cover keep their old timing; deleted ones drop out.
  const old = readTimings();
  const seconds = {};
  for (const f of specFiles()) {
    const s = measured[f] ?? old[f];
    if (s !== undefined) seconds[f] = Math.round(s * 10) / 10;
  }
  const about = "Seconds of test time per e2e spec file on CI, for scripts/e2e-shard.mjs. Regenerate, don't hand-edit.";
  fs.writeFileSync(TIMINGS, JSON.stringify({ about, seconds }, null, 2) + "\n");
  console.log(`e2e-shard: wrote ${Object.keys(seconds).length} spec timings from ${reports.length} report(s).`);
}

const [a, b, ...rest] = process.argv.slice(2);
if (a === "--update") update([b, ...rest].filter(Boolean));
else if (a === "--plan") {
  const total = Number(b);
  if (!Number.isInteger(total) || total < 1) fail("usage: --plan <total>");
  for (const [i, s] of plan(total).entries())
    console.log(`shard ${i + 1}: ${s.seconds.toFixed(0)} s, ${s.files.length} files: ${s.files.join(" ")}`);
} else {
  const current = Number(a);
  const total = Number(b);
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(current) || current < 1 || current > total)
    fail("usage: <current> <total> (one-based)");
  const files = plan(total)[current - 1].files;
  // An empty list would make `playwright test` run everything.
  if (!files.length) fail(`shard ${current}/${total} got no spec files; use fewer shards.`);
  console.log(files.map((f) => path.posix.join(TEST_DIR, f)).join(" "));
}
