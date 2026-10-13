import type { DiagramChecks } from "../model/types";
import type { Evidence } from "./evidence";
import type { CheckResult, Finding, FindingEvidence } from "./types";

// Puts what Run simulations found (src/checks/evidence.ts) on the checks' result: counts on the findings they bear
// out, and the `dropped` findings after the rest (they're Suggestions, and the last rule). Small and free of the
// simulation engine, so the Checks card and check_diagram can merge without loading it.

/**
 * `result` with `evidence` on it. `checks` is the file's own (ignores and turned-off checks) as `result` saw it: a
 * `dropped` finding ignored there goes with the ignored ones, and none show when the check is off.
 */
export function withEvidence(result: CheckResult, evidence: Evidence, checks: DiagramChecks | undefined): CheckResult {
  const attach = (f: Finding): Finding => {
    const counts = evidence.byFinding[f.id];
    return counts?.length ? { ...f, evidence: counts } : f;
  };
  const off = (checks?.off ?? []).includes("dropped");
  const ignores = new Set((checks?.ignore ?? []).map((i) => `${i.rule}:${i.target}`));
  const extra = off ? [] : evidence.findings;
  return {
    ...result,
    findings: [...result.findings.map(attach), ...extra.filter((f) => !ignores.has(f.id))],
    ignored: [...result.ignored.map(attach), ...extra.filter((f) => ignores.has(f.id))],
  };
}

const count = (n: number) => n.toLocaleString("en-US");

/** One count in words: "312 dropped in “Payments goes down”", "30 left unread in the first minute of “Backfill”". */
export function evidenceText(e: FindingEvidence): string {
  const what = e.what === "dropped" ? "dropped" : "left unread";
  return `${count(e.count)} ${what} in ${e.capped ? "the first minute of " : ""}“${e.simulation}”`;
}
