import type { DiagramOp } from "../ai";
import type { CheckRuleId } from "../model/checks";
import type { CheckResult, CheckSeverity, Finding } from "./types";
import { summarize } from "./run";
import type { Evidence } from "./evidence";
import { evidenceText } from "./evidenceMerge";

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
const MAX_OPTIONS = 4;
const MAX_OPTION = 80;
/** Room kept for the `more` line. */
const MORE_ROOM = 120;
/** A finding's simulation counts, and the line saying what was played. */
const MAX_EVIDENCE = 3;
const MAX_SIMULATIONS = 300;

export interface AgentFinding {
  id: string;
  rule: CheckRuleId;
  severity: CheckSeverity;
  title: string;
  message?: string;
  targets: string[];
  /** Elements beyond `targets`, left out for size. */
  moreTargets?: number;
  /** What the saved simulations lost here (with `simulations: true`): "312 dropped in “Payments goes down”". */
  evidence?: string[];
  fix?:
    | { label: string; ops: DiagramOp[]; others?: AgentFixOption[]; elsewhere?: string }
    | { label: string; needsChoice: string };
}

/** Another way to make the same fix: its words, the stencil it adds, and its ops, ready to send instead. */
export interface AgentFixOption {
  label: string;
  kind?: string;
  ops: DiagramOp[];
}

export interface AgentReport {
  findings: AgentFinding[];
  summary: string;
  /** With `simulations: true`: what was played, and what was lost on purpose (never a finding). */
  simulations?: string;
  more?: string;
  hint?: string;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const size = (value: unknown) => JSON.stringify(value).length;

/**
 * The fix's other options that fit beside the default's ops (within the same per-finding bound), each with its own
 * ops, ready to send; the rest are only named (`elsewhere`), for the person to pick in the Checks card. An option
 * without its ops is never listed as one to send.
 */
function others(f: Finding): { list?: AgentFixOption[]; elsewhere?: string } {
  let room = MAX_OPS - size(f.fix?.ops ?? []);
  const list: AgentFixOption[] = [];
  const left: string[] = [];
  for (const o of f.fix?.options?.slice(0, MAX_OPTIONS) ?? []) {
    if (size(o.ops) > room) {
      left.push(clip(o.label, MAX_OPTION));
      continue;
    }
    room -= size(o.ops);
    list.push({ label: clip(o.label, MAX_OPTION), ...(o.kind ? { kind: clip(o.kind, MAX_OPTION) } : {}), ops: o.ops });
  }
  return {
    ...(list.length ? { list } : {}),
    ...(left.length
      ? {
          elsewhere: `Also possible, too long for this reply (the person can pick it in the Checks card): ${left.join("; ")}.`,
        }
      : {}),
  };
}

/** The finding at its fullest within the per-finding bounds. */
function bounded(f: Finding): AgentFinding {
  const usable = f.elements.filter((id) => id.length <= MAX_ID);
  const targets = usable.slice(0, MAX_TARGETS);
  const label = clip(f.fix?.label ?? "", MAX_TEXT);
  const fix: AgentFinding["fix"] = !f.fix
    ? undefined
    : f.fix.ops && size(f.fix.ops) <= MAX_OPS
      ? (() => {
          const { list, elsewhere } = others(f);
          return { label, ops: f.fix.ops, ...(list ? { others: list } : {}), ...(elsewhere ? { elsewhere } : {}) };
        })()
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
    ...(f.evidence?.length
      ? { evidence: f.evidence.slice(0, MAX_EVIDENCE).map((e) => clip(evidenceText(e), MAX_OPTION)) }
      : {}),
    ...(fix ? { fix } : {}),
  };
}

/** "Played 2 saved simulations (at most 60 s each). On purpose, not findings: 96 dropped at alb-us in …." */
function playedLine(e: Evidence): string {
  const n = e.played.length;
  const parts = [
    `Played ${n} saved simulation${n === 1 ? "" : "s"} (at most 60 s each${e.played.some((p) => p.capped) ? "; some stopped there" : ""}).`,
    e.unplayed.length ? `Out of time before: ${e.unplayed.map((t) => `“${t}”`).join(", ")}.` : "",
    e.planned.length
      ? `On purpose, not findings: ${e.planned
          .map(
            (p) =>
              `${p.count} ${p.what === "dropped" ? "dropped at" : "left unread in"} ${p.node} in “${p.simulation}”`,
          )
          .join("; ")}.`
      : "",
  ];
  return clip(parts.filter(Boolean).join(" "), MAX_SIMULATIONS);
}

/** Smaller and smaller versions of a finding, for when even one doesn't fit. */
function* shrink(full: AgentFinding): Generator<AgentFinding> {
  yield full;
  const { message: _message, evidence: _evidence, ...noMessage } = full;
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

export function agentReport(
  result: CheckResult,
  include: "warnings" | "all" = "all",
  evidence?: Evidence,
): AgentReport {
  const listed = result.findings.filter((f) => include === "all" || f.severity === "warning");
  const report: AgentReport = {
    findings: [],
    summary: summarize(result),
    ...(evidence ? { simulations: playedLine(evidence) } : {}),
  };
  if (listed.some((f) => f.fix?.ops))
    report.hint =
      "To fix one, send its fix.ops to edit_diagram as they are (one undo step). Only the person can ignore a finding." +
      (listed.some((f) => f.fix?.ops && others(f).list)
        ? " fix.others are other ways to make the same change: if the person prefers one, send its ops instead."
        : "");
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
