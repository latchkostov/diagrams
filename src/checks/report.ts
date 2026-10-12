import type { DiagramOp } from "../ai";
import type { CheckRuleId } from "../model/checks";
import type { CheckResult, CheckSeverity, Finding } from "./types";
import { summarize } from "./run";

// check_diagram's output for agents: the findings with their fixes as edit_diagram ops, always under the
// WebMCP tools' 1.5K-character budget. Every finding is bounded on its own (text clipped, targets listed up
// to a dozen, ops dropped for a pointer when they don't fit), and the report keeps the longest prefix that
// fits: warnings come first, so a long list loses suggestions first. Each finding is serialized a bounded
// number of times, so the work is linear in the findings kept.

export const OUTPUT_BUDGET = 1500;
const MAX_TITLE = 160;
const MAX_MESSAGE = 400;
const MAX_TEXT = 300;
const MAX_TARGETS = 12;
const MAX_ID = 200;
const MAX_OPS = 700;
/** Room kept for the `more` line. */
const MORE_ROOM = 120;

export interface AgentFinding {
  id: string;
  rule: CheckRuleId;
  severity: CheckSeverity;
  title: string;
  message?: string;
  targets: string[];
  /** Elements beyond `targets`, left out for size. */
  moreTargets?: number;
  fix?: { label: string; ops: DiagramOp[] } | { label: string; needsChoice: string };
}

export interface AgentReport {
  findings: AgentFinding[];
  summary: string;
  more?: string;
  hint?: string;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const size = (value: unknown) => JSON.stringify(value).length;

/** The finding at its fullest within the per-finding bounds. */
function bounded(f: Finding): AgentFinding {
  const usable = f.elements.filter((id) => id.length <= MAX_ID);
  const targets = usable.slice(0, MAX_TARGETS);
  const label = clip(f.fix?.label ?? "", MAX_TEXT);
  const fix: AgentFinding["fix"] = !f.fix
    ? undefined
    : f.fix.ops && size(f.fix.ops) <= MAX_OPS
      ? { label, ops: f.fix.ops }
      : {
          label,
          needsChoice: f.fix.ops
            ? "Its edit ops are too long for this reply: make the change with edit_diagram."
            : clip(f.fix.choice ?? "Ask the person what to add.", MAX_TEXT),
        };
  return {
    id: clip(f.id, MAX_ID),
    rule: f.rule,
    severity: f.severity,
    title: clip(f.title, MAX_TITLE),
    message: clip(f.message, MAX_MESSAGE),
    targets,
    ...(f.elements.length > targets.length ? { moreTargets: f.elements.length - targets.length } : {}),
    ...(fix ? { fix } : {}),
  };
}

/** Smaller and smaller versions of a finding, for when even one doesn't fit. */
function* shrink(full: AgentFinding): Generator<AgentFinding> {
  yield full;
  const { message: _message, ...noMessage } = full;
  yield noMessage;
  const total = full.targets.length + (full.moreTargets ?? 0);
  const one = {
    ...noMessage,
    targets: full.targets.slice(0, 1),
    moreTargets: total - Math.min(1, full.targets.length),
  };
  yield one;
  const fix = full.fix && { label: clip(full.fix.label, 80), needsChoice: "Call check_diagram with this rule only." };
  yield { ...one, title: clip(full.title, 80), ...(fix ? { fix } : {}) };
  const { fix: _fix, ...bare } = one;
  yield { ...bare, title: clip(full.title, 60) };
}

export function agentReport(result: CheckResult, include: "warnings" | "all" = "all"): AgentReport {
  const listed = result.findings.filter((f) => include === "all" || f.severity === "warning");
  const report: AgentReport = { findings: [], summary: summarize(result) };
  if (listed.some((f) => f.fix?.ops))
    report.hint =
      "To fix one, send its fix.ops to edit_diagram as they are (one undo step). Only the person can ignore a finding.";
  // `findings: []` already counted; each kept finding adds its JSON and a comma.
  let used = size(report) + MORE_ROOM;
  for (const f of listed) {
    let kept: AgentFinding | undefined;
    // Later findings go in whole or not at all; the first may shrink so the reply is never empty.
    for (const candidate of report.findings.length ? [bounded(f)] : shrink(bounded(f))) {
      if (used + size(candidate) + 1 <= OUTPUT_BUDGET) {
        kept = candidate;
        break;
      }
    }
    if (!kept) break;
    used += size(kept) + 1;
    report.findings.push(kept);
  }
  const omitted = listed.length - report.findings.length;
  if (omitted)
    report.more = `${omitted} more finding${omitted === 1 ? "" : "s"} omitted; call check_diagram with rules to see them.`;
  // The bounds above make this hold; the check keeps the promise if they ever drift.
  if (size(report) > OUTPUT_BUDGET)
    return { findings: [], summary: report.summary, more: "Findings omitted: call check_diagram with rules." };
  return report;
}
