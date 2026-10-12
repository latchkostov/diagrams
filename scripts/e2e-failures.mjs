// Lists the tests that failed in Playwright JSON reports, as Markdown: each test once, with how many of its
// runs failed (a run is a repeat or a retry), so a flake reads "failed 1 of 3". Reports with the same label
// (say, a job's shards) share a section. The nightly workflow puts this in its issue. Prints nothing when
// every test passed.
// Usage: node scripts/e2e-failures.mjs "<label>=<report.json>" ...   (a label has no "=")
import fs from "node:fs";
import process from "node:process";
import console from "node:console";

// eslint-disable-next-line no-control-regex
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** label → test → { runs, failed, error } */
const sections = new Map();
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf("=");
  const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : ["", arg];
  if (!fs.existsSync(file)) continue;
  const tests = sections.get(label) ?? new Map();
  sections.set(label, tests);
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests) {
        const key = `${spec.file}:${spec.line} › ${[...titles, spec.title].join(" › ")} [${t.projectName}]`;
        const entry = tests.get(key) ?? { runs: 0, failed: 0, error: "" };
        for (const r of t.results ?? []) {
          if (r.status === "skipped") continue;
          entry.runs++;
          if (r.status !== "passed") {
            entry.failed++;
            entry.error ||= strip(r.error?.message ?? r.status)
              .split("\n")[0]
              .slice(0, 200);
          }
        }
        tests.set(key, entry);
      }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  for (const s of JSON.parse(fs.readFileSync(file, "utf8")).suites ?? []) walk(s, []);
}

const out = [];
for (const [label, tests] of sections) {
  const failed = [...tests].filter(([, e]) => e.failed > 0).sort((a, b) => a[0].localeCompare(b[0]));
  if (!failed.length) continue;
  if (label) out.push(`**${label}** (${failed.length} failed):`, "");
  for (const [key, e] of failed)
    out.push(`- \`${key}\`: failed ${e.failed} of ${e.runs}${e.error ? `: ${e.error.replaceAll("`", "'")}` : ""}`);
  out.push("");
}
if (out.length) console.log(out.join("\n"));
