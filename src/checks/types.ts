// Architecture checks (docs/research/architecture-checks.md): a small, fixed rule set over the diagram model.
// Pure and deterministic: no network, no randomness, no UI. Lazy-loaded; never in the startup JavaScript.

import type { DiagramOp } from "../ai";
import type { CheckRuleId } from "../model/checks";
import type { CheckContext } from "./context";

export type { CheckRuleId } from "../model/checks";

/** No "error": nothing here blocks saving, sharing or going live. */
export type CheckSeverity = "warning" | "suggestion";

export interface CheckFix {
  /** The button's words, naming the change ("Add dead-letter queue"). */
  label: string;
  /** The change as edit_diagram ops: one applyOps call, one undo step. Absent when it needs a choice. */
  ops?: DiagramOp[];
  /** What has to be chosen first, when there are no ops ("Pick what reads orders.dlq…"). */
  choice?: string;
}

export interface Finding {
  /** `${rule}:${target}`: stable across renames and moves. */
  id: string;
  rule: CheckRuleId;
  severity: CheckSeverity;
  /** The element the finding is about; with the rule, what an ignore names. */
  target: string;
  /** Every node and connection involved, target first. */
  elements: string[];
  /** One line, in the app's words ("Nobody reads orders.created.v1"). */
  title: string;
  /** What's wrong here, naming the things involved. */
  message: string;
  /** Why it matters, in general. */
  rationale: string;
  fix?: CheckFix;
}

export interface CheckRule {
  id: CheckRuleId;
  /** The rule's name for About this check ("Failed messages are dropped"). */
  name: string;
  /** Two lines: why it matters, and how it decides. */
  about: string;
  detect(ctx: CheckContext): Finding[];
}

export interface CheckResult {
  /** Shown: warnings first, then suggestions; within each, rule order, then reading order. */
  findings: Finding[];
  /** Found, but a person ignored them in this diagram (`checks.ignore`). */
  ignored: Finding[];
  /** Rules turned off in this diagram (`checks.off`) that this version knows. */
  off: CheckRuleId[];
  /** Rules that ran. */
  ran: CheckRuleId[];
}
