// Architecture checks (docs/research/architecture-checks.md): a small, fixed rule set over the diagram model.
// Pure and deterministic: no network, no randomness, no UI. Lazy-loaded; never in the startup JavaScript.

import type { DiagramOp } from "../ai";
import type { CheckRuleId } from "../model/checks";
import type { CheckContext } from "./context";
import type { BrokerSpec } from "../model/brokers";

export type { CheckRuleId } from "../model/checks";

/** No "error": nothing here blocks saving, sharing or going live. */
export type CheckSeverity = "warning" | "suggestion";

export interface CheckFix {
  /** Neutral broker vocabulary, translated only by the UI; label stays English for agents and workers. */
  brokerChanges?: { text: string; name: string; spec: BrokerSpec; count: number }[];
  /** The button's words, naming the change ("Add dead-letter queue"). */
  label: string;
  /** The change as edit_diagram ops: one applyOps call, one undo step. Absent when it needs a choice. */
  ops?: DiagramOp[];
  /** What has to be chosen first, when there are no ops ("Pick what reads orders.dlq…"). */
  choice?: string;
  /**
   * Other ways to make the same change, one click each (a gateway of another kind): shown as chips beside the
   * button. The fix's own `label` and `ops` are the default; these are the rest.
   */
  options?: CheckFixOption[];
}

export interface CheckFixOption {
  /** The change in words ("Put API Management in front"). */
  label: string;
  /** The chip's words: what's different about this option ("API Management"). */
  short: string;
  /** The stencil it adds, when it adds one (agents can swap it into the default's ops). */
  kind?: string;
  ops: DiagramOp[];
}

export interface Finding {
  resourceFinding?: {
    name: string;
    kind: "memory" | "invalid" | "baseline" | "max" | "keda" | "binding";
    needed: number;
    max: number;
    keda?: { rate: number; lag: number; poll: number; startup: number };
  };
  /** A3 scenario sizing (src/checks/scalingFindings.ts): neutral fields the UI translates. */
  scalingPlan?: {
    kind: "max" | "min" | "partitions" | "quota" | "target" | "unavailable";
    /** The scaled node's name, as the title shows it. */
    name: string;
    simulation: string;
    traffic: number;
    platform?: string;
    /** What this platform calls its replicas. */
    unit?: "tasks" | "instances" | "replicas";
    from?: number;
    to?: number;
    wanted?: number;
    metric?: number;
    target?: number;
    metricKind?: string;
    broker?: string;
    startupBacklog?: number;
    rejected?: number;
    verified?: boolean;
    reason?: string;
  };
  admissionRejection?: { text: string; rate: number };
  /** Neutral rationale descriptor; rationale stays English for workers and agents. */
  brokerRationale?: "no-reader";
  brokerAssignment?: { text: string; spec: BrokerSpec; active: number; configured: number };
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
  /**
   * What the diagram's saved simulations showed here, when Run simulations has played them (src/checks/evidence.ts):
   * "312 dropped in Payments goes down". Never in the file; gone when the diagram changes.
   */
  evidence?: FindingEvidence[];
}

/** One count from one saved simulation, in real messages. */
export interface FindingEvidence {
  /** The simulation's title. */
  simulation: string;
  /** dropped: lost (no dead-letter route, or nothing to take a request); unread: left in a queue nobody reads. */
  what: "dropped" | "unread";
  count: number;
  /** The simulation was stopped at the 60 s cap: the count is for its first minute. */
  capped?: boolean;
}

export interface CheckRule {
  id: CheckRuleId;
  /** The rule's name for About this check ("Failed messages are dropped"). */
  name: string;
  /** Two lines: why it matters, and how it decides. */
  about: string;
  detect(ctx: CheckContext): Finding[];
  /** Raised only by playing the saved simulations (Run simulations), never by the checks that run as you edit. */
  onDemand?: boolean;
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
