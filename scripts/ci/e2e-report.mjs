import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { pendingReport, readTestReport, writeCheckpoint } from "../gate/reporter.mjs";

export function seedReport(directory) {
  mkdirSync(directory, { recursive: true });
  rmSync(join(directory, "results.json"), { force: true });
  writeCheckpoint(join(directory, "checkpoint.json"), {
    ...pendingReport(),
    reason: "Interrupted or failed before Playwright discovered tests; no test counts available",
  });
}

/** Run outside the composite action so its deadline cannot prevent collection. */
export function collectReport(directory) {
  let report;
  try {
    report = readTestReport(directory);
  } catch {
    report = { ...pendingReport(), reason: "Interrupted or failed before a readable test report was written" };
  }
  mkdirSync(directory, { recursive: true });
  writeCheckpoint(join(directory, "results.json"), report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, directory] = process.argv.slice(2);
  if (!directory || !["seed", "collect"].includes(action))
    throw new Error("Usage: node scripts/ci/e2e-report.mjs <seed|collect> <report-directory>");
  if (action === "seed") seedReport(directory);
  else collectReport(directory);
}
