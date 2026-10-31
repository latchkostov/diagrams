// Lists the tests that failed in Playwright JSON reports, as Markdown: each test once, with how many of its
// runs failed (a run is a repeat or a retry), so a flake reads "failed 1 of 3". Reports with the same label
// (say, a job's shards) share a section. Native reports also include counts and interruption markers.
// The nightly workflow puts this in its issue.
// Usage: node scripts/e2e-failures.mjs "<label>=<report.json>" ...   (a label has no "=")
//        node scripts/e2e-failures.mjs --collect-native <gate-directory> <output.json>
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTestReport } from "./gate/reporter.mjs";

/** Collect one native job's final reports, falling back to the per-test checkpoint. */
export function collectNative(directory) {
  const reports = [];
  for (const run of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) {
    if (!run.isDirectory()) continue;
    const root = path.join(directory, run.name);
    for (const step of fs.readdirSync(root, { withFileTypes: true })) {
      if (!step.isDirectory() || !/^(unit|heavy|e\d+)$/.test(step.name)) continue;
      let report;
      try {
        report = readTestReport(path.join(root, step.name));
      } catch {
        // No usable report: keep an explicit marker for this step.
      }
      reports.push({
        source: `${run.name}/${step.name}`,
        report: report ?? {
          interrupted: true,
          reason: "Interrupted or failed before the test report was written",
        },
      });
    }
  }
  if (!reports.length)
    reports.push({
      source: "gate",
      report: {
        interrupted: true,
        reason: "Interrupted or failed before tests started; no test counts available",
      },
    });
  return { native: reports };
}

// eslint-disable-next-line no-control-regex
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

export function failureSummary(inputs) {
  /** label → test → { runs, failed, error } */
  const sections = new Map();
  const notices = new Map();
  const unitFailures = new Map();
  const read = (label, report, native = false) => {
    if (report.native) {
      for (const { source, report: child } of report.native) read(`${label} (${source})`, child, true);
      return;
    }
    const notes = notices.get(label) ?? [];
    notices.set(label, notes);
    if (report.interrupted)
      notes.push(
        `Interrupted: ${report.reason ?? `${report.completed} of ${report.expectedTests} tests completed; counts are partial`}.`,
      );
    for (const test of report.unfinished ?? [])
      notes.push(`- ${test.file}:${test.line} › ${test.title} [${test.projectName}]: unfinished (${test.state})`);
    if (report.stats && (native || report.interrupted)) {
      const s = report.stats;
      notes.push(`Recorded: ${s.expected} passed, ${s.unexpected} failed, ${s.flaky} flaky, ${s.skipped} skipped.`);
    }
    for (const error of report.errors ?? [])
      notes.push(`Runner error: ${strip(error.message ?? String(error)).split("\n")[0]}`);
    if (report.numTotalTests !== undefined) {
      unitFailures.set(label, (unitFailures.get(label) ?? 0) + report.numFailedTests);
      notes.push(
        `Unit: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped.`,
      );
      for (const suite of report.testResults ?? [])
        for (const test of suite.assertionResults ?? [])
          if (test.status === "failed") {
            // fast-check's seed and shrink path are below the first line. Keep the reduced reproduction too.
            const message = strip(test.failureMessages?.join("\n") || "failed").replaceAll("```", "'''");
            notes.push(`- ${test.fullName}: ${message.split("\n")[0]}`);
            if (message.includes("\n")) notes.push("", "```text", message, "```", "");
          }
    }
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
    for (const s of report.suites ?? []) walk(s, []);
  };
  for (const { label, report } of inputs) read(label, report);

  const out = [];
  for (const [label, tests] of sections) {
    const failed = [...tests].filter(([, e]) => e.failed > 0).sort((a, b) => a[0].localeCompare(b[0]));
    const notes = notices.get(label) ?? [];
    if (!failed.length && !notes.length) continue;
    if (label) out.push(`**${label}** (${failed.length + (unitFailures.get(label) ?? 0)} failed):`, "");
    out.push(...notes);
    for (const [key, e] of failed)
      out.push(`- \`${key}\`: failed ${e.failed} of ${e.runs}${e.error ? `: ${e.error.replaceAll("`", "'")}` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--collect-native") {
    const [, directory, output] = args;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(collectNative(directory), null, 2));
  } else {
    const inputs = args.flatMap((arg) => {
      const eq = arg.indexOf("=");
      const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : ["", arg];
      return fs.existsSync(file) ? [{ label, report: JSON.parse(fs.readFileSync(file, "utf8")) }] : [];
    });
    const summary = failureSummary(inputs);
    if (summary) console.log(summary);
  }
}
