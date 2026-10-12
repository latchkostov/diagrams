import type { DiagramOp } from "../ai";
import type { CheckRuleId } from "../model/checks";
import type { CheckResult, CheckSeverity } from "./types";
import { summarize } from "./run";

// check_diagram's output for agents: the findings with their fixes as edit_diagram ops, kept under the
// WebMCP tools' 1.5K-character budget (warnings come first, so a long list loses suggestions first).

const OUTPUT_BUDGET = 1500;

export interface AgentFinding {
  id: string;
  rule: CheckRuleId;
  severity: CheckSeverity;
  title: string;
  message: string;
  targets: string[];
  fix?: { label: string; ops: DiagramOp[] } | { label: string; needsChoice: string };
}

export interface AgentReport {
  findings: AgentFinding[];
  summary: string;
  more?: string;
  hint?: string;
}

export function agentReport(result: CheckResult, include: "warnings" | "all" = "all"): AgentReport {
  const findings: AgentFinding[] = result.findings
    .filter((f) => include === "all" || f.severity === "warning")
    .map((f) => ({
      id: f.id,
      rule: f.rule,
      severity: f.severity,
      title: f.title,
      message: f.message,
      targets: f.elements,
      ...(f.fix
        ? {
            fix: f.fix.ops
              ? { label: f.fix.label, ops: f.fix.ops }
              : { label: f.fix.label, needsChoice: f.fix.choice ?? "Ask the person what to add." },
          }
        : {}),
    }));
  const report: AgentReport = {
    findings,
    summary: summarize(result),
    ...(findings.some((f) => f.fix && "ops" in f.fix)
      ? {
          hint: "To fix one, send its fix.ops to edit_diagram as they are (one undo step). Only the person can ignore a finding.",
        }
      : {}),
  };
  const size = () => JSON.stringify(report).length;
  while (size() > OUTPUT_BUDGET && report.findings.length > 1) {
    report.findings = report.findings.slice(0, -1);
    report.more = `${findings.length - report.findings.length} more findings omitted; call check_diagram with rules to see them.`;
  }
  // One finding over the budget on its own: its message goes first, never its fix.
  if (size() > OUTPUT_BUDGET && report.findings[0]) report.findings[0] = { ...report.findings[0], message: "" };
  return report;
}
