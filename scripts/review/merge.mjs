import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { consolidate, renderReport } from "./triage.mjs";
import { nextState } from "./rounds.mjs";
import { git } from "./scope.mjs";
import { replaceState } from "./state.mjs";

const dir = process.argv[2];
const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
// Missing or malformed lenses must fail the round, never silently close a P1.
const reports = plan.angles.map((angle) => ({
  angle,
  report: JSON.parse(fs.readFileSync(path.join(dir, `${angle}.json`), "utf8")),
}));
const result = consolidate(reports, plan);
for (const warning of result.warnings) console.warn(warning);
const reportFile = path.join(dir, "REPORT.md");
fs.writeFileSync(path.join(dir, "triage.json"), JSON.stringify(result, null, 2));
fs.writeFileSync(reportFile, renderReport(path.basename(dir), plan, result, reports));
if (git(process.cwd(), "rev-parse", "HEAD").trim() !== plan.scope.head)
  throw new Error("HEAD changed during review; state was not advanced");
if (!plan.full && !plan.audit) {
  await replaceState(
    plan.stateFile,
    plan.expectedState,
    () => {
      if (git(process.cwd(), "rev-parse", "HEAD").trim() !== plan.scope.head)
        throw new Error("HEAD changed during review; state was not advanced");
      return nextState(plan, plan.scope, result.issues, reportFile);
    },
    () => console.log("Waiting for review state lock"),
  );
}
console.log(`Consolidated ${result.rawCount} raw findings into ${result.issues.length} distinct issues`);
