import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { consolidate, renderReport } from "./triage.mjs";
import { nextState } from "./rounds.mjs";
import { git } from "./scope.mjs";

const dir = process.argv[2];
const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8"));
// Missing or malformed lenses must fail the round, never silently close a P1.
const reports = plan.angles.map((angle) => ({
  angle,
  report: JSON.parse(fs.readFileSync(path.join(dir, `${angle}.json`), "utf8")),
}));
const result = consolidate(reports, plan);
const reportFile = path.join(dir, "REPORT.md");
fs.writeFileSync(path.join(dir, "triage.json"), JSON.stringify(result, null, 2));
fs.writeFileSync(reportFile, renderReport(path.basename(dir), plan, result, reports));
if (git(process.cwd(), "rev-parse", "HEAD").trim() !== plan.scope.head)
  throw new Error("HEAD changed during review; state was not advanced");
if (!plan.full) {
  const current = fs.existsSync(plan.stateFile) ? JSON.parse(fs.readFileSync(plan.stateFile, "utf8")) : null;
  if (JSON.stringify(current) !== JSON.stringify(plan.state))
    throw new Error("Another review advanced branch state; state was not overwritten");
  fs.mkdirSync(path.dirname(plan.stateFile), { recursive: true });
  const temporary = `${plan.stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(nextState(plan, plan.scope, result.issues, reportFile), null, 2));
  fs.renameSync(temporary, plan.stateFile);
}
console.log(`Consolidated ${result.rawCount} raw findings into ${result.issues.length} distinct issues`);
