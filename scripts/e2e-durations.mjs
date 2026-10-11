// Summarises a Playwright JSON report: wall time, the slowest tests and spec files, and every test that
// needed a retry. CI runs it after each e2e shard and appends the Markdown to the job summary.
// Usage: node scripts/e2e-durations.mjs [report.json] [top-n]
import fs from "node:fs";
import process from "node:process";
import console from "node:console";

const file = process.argv[2] ?? "tests/.output/results.json";
const top = Number(process.argv[3] ?? 15);
if (!fs.existsSync(file)) {
  console.log(`e2e-durations: ${file} not found (no tests ran?).`);
  process.exit(0);
}
const report = JSON.parse(fs.readFileSync(file, "utf8"));

const tests = [];
const walk = (suite, path) => {
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests) {
      const runs = t.results ?? [];
      tests.push({
        file: spec.file,
        title: [...path, spec.title].join(" › "),
        project: t.projectName,
        seconds: runs.reduce((sum, r) => sum + r.duration, 0) / 1000,
        retries: Math.max(0, runs.length - 1),
        status: t.status,
      });
    }
  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
};
// Top-level suites are spec files; their children are describe blocks.
for (const fileSuite of report.suites ?? []) walk(fileSuite, []);

const s = (n) => n.toFixed(1);
const total = tests.reduce((sum, t) => sum + t.seconds, 0);
const wall = (report.stats?.duration ?? 0) / 1000;
const out = [
  `### E2E durations`,
  ``,
  `${tests.length} tests, ${s(total)} s of test time, ${s(wall)} s wall.`,
  ``,
  `| s | spec | test |`,
  `|---:|---|---|`,
  ...[...tests]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, top)
    .map((t) => `| ${s(t.seconds)} | ${t.file} | ${t.title.replaceAll("|", "\\|")} |`),
];
const byFile = new Map();
for (const t of tests) byFile.set(t.file, (byFile.get(t.file) ?? 0) + t.seconds);
out.push(``, `| s | spec file |`, `|---:|---|`);
for (const [f, sec] of [...byFile].sort((a, b) => b[1] - a[1])) out.push(`| ${s(sec)} | ${f} |`);
const retried = tests.filter((t) => t.retries > 0);
out.push(``, retried.length ? `**Needed a retry (${retried.length}):**` : `No test needed a retry.`);
for (const t of retried)
  out.push(`- ${t.file} › ${t.title} (${t.retries} retr${t.retries === 1 ? "y" : "ies"}, ${t.status})`);
console.log(out.join("\n"));
