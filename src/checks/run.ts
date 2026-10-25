import type { DiagramFile } from "../model/types";
import { CHECK_RULES, isCheckRule, type CheckRuleId } from "../model/checks";
import { buildContext } from "./context";
import type { CheckResult, CheckRule, Finding } from "./types";
import { deadLetter } from "./rules/deadLetter";
import { noReader } from "./rules/noReader";
import { syncCycle } from "./rules/syncCycle";
import { messageLoop } from "./rules/messageLoop";
import { syncChain } from "./rules/syncChain";
import { sharedDatabase } from "./rules/sharedDatabase";
import { entryGateway } from "./rules/entryGateway";
import { capacity, WAIT_RULES } from "./rules/capacity";
import { singlePoint } from "./rules/singlePoint";
import { secretIdentity } from "./rules/secretIdentity";
import { schemaRegistry } from "./rules/schemaRegistry";
import { dropped } from "./rules/dropped";
import { blockedThreads, scalingBlind, callTimeout, provideRequestFindings } from "./requestFindings";
import type { CheckContext } from "./context";
import { resilienceRules } from "./resilienceFindings";
import { requestFindings } from "./requestFindings";

/**
 * Every rule, in CHECK_RULES order (the order findings list them). `dropped` is raised only by Run simulations
 * (src/checks/evidence.ts): it's here for its name and About, and never runs in `runChecks`.
 */
export const RULES: readonly CheckRule[] = [
  deadLetter,
  noReader,
  syncCycle,
  messageLoop,
  syncChain,
  sharedDatabase,
  entryGateway,
  capacity,
  blockedThreads,
  scalingBlind,
  callTimeout,
  ...resilienceRules(requestFindings),
  singlePoint,
  secretIdentity,
  schemaRegistry,
  dropped,
];

export interface RunOptions {
  fixTarget?: string;
  /** Worker-unavailable fallback only: permit verification on this thread. */
  local?: boolean;
  /** Only these rules (default: all). Rules turned off in the diagram stay off. */
  rules?: readonly CheckRuleId[];
  /** This diagram's request findings, already awaited (awaitRequestChecks): read instead of the shared cache. */
  requests?: Finding[];
  /** A context already built for this diagram (the worker's): its capacity analysis is worked out once. */
  context?: CheckContext;
}

/**
 * Runs the checks on a diagram. Pure and deterministic: the same diagram gives the same findings in the
 * same order. Honours the file's `checks`: turned-off rules don't run, ignored findings are set apart.
 * Scenario sizing is the exception in the editor: there it comes only from the checks worker
 * (src/lib/scenarioPlanner.ts), so a diagram the worker hasn't planned yet has no sizing finding until it has.
 * Request findings must already be ready in the editor: pass the awaited ones (`requests`); a cache miss or failure
 * throws rather than report a clean result. `requestChecksNeeded` says whether a run reads them.
 */
export function runChecks(diagram: DiagramFile, opts: RunOptions = {}): CheckResult {
  const off = (diagram.checks?.off ?? []).filter(isCheckRule);
  const ran = RULES.filter((r) => !r.onDemand && !off.includes(r.id) && (!opts.rules || opts.rules.includes(r.id))).map(
    (r) => r.id,
  );
  const ctx = opts.context ?? buildContext(diagram);
  ctx.fixTarget = opts.fixTarget;
  if (opts.local) ctx.local = true;
  if (opts.requests) provideRequestFindings(ctx, opts.requests);
  ctx.ran = new Set(ran);
  const detected = RULES.filter((r) => ran.includes(r.id)).flatMap((r) => r.detect(ctx));
  // A bounded rule's count of what it couldn't list: reported beside the findings, never as one.
  const omitted = detected.flatMap((f) => (f.omitted ? [{ rule: f.rule, count: f.omitted }] : []));
  const retryStorm = detected.reduce((n, f) => n + (f.unchecked ?? 0), 0);
  const all = detected.filter((f) => !f.omitted && !f.unchecked);
  const ignores = new Set((diagram.checks?.ignore ?? []).map((i) => `${i.rule}:${i.target}`));
  all.sort(findingOrder(ctx.rank));
  return {
    findings: all.filter((f) => !ignores.has(f.id)),
    ignored: all.filter((f) => ignores.has(f.id)),
    off: CHECK_RULES.filter((id) => off.includes(id)),
    ran,
    ...(omitted.length ? { omitted } : {}),
    ...(retryStorm ? { notChecked: { retryStorm } } : {}),
  };
}

/**
 * A result as if only `rules` had been asked for (default: all): its findings, ignored findings, rules that ran and
 * omitted counts, together. For a result worked out with more rules (Run simulations classifies against every one).
 */
export function onlyRules(result: CheckResult, rules?: readonly CheckRuleId[]): CheckResult {
  if (!rules) return result;
  const wanted = (f: { rule: CheckRuleId }) => rules.includes(f.rule);
  const { omitted, notChecked, ...rest } = result;
  const kept = omitted?.filter(wanted) ?? [];
  return {
    ...rest,
    findings: result.findings.filter(wanted),
    ignored: result.ignored.filter(wanted),
    ran: result.ran.filter((id) => rules.includes(id)),
    ...(kept.length ? { omitted: kept } : {}),
    ...(notChecked && rules.includes("retry-storm") ? { notChecked } : {}),
  };
}

/**
 * Run simulations' reply for `rules`: losses are classified against every check (`full`, with evidence attached), but
 * the findings are the requested rules' own run (`asked`), so a rule that defers to another (capacity) only defers
 * when that one was asked for too. Each keeps the evidence the full run attached; evidence-only findings (`dropped`)
 * come from the full run.
 */
export function askedWithEvidence(full: CheckResult, asked: CheckResult, rules?: readonly CheckRuleId[]): CheckResult {
  if (!rules) return full;
  const counted = new Map([...full.findings, ...full.ignored].map((f) => [f.id, f]));
  const ran = new Set(asked.ran);
  const evidenceOnly = (f: Finding) => rules.includes(f.rule) && !ran.has(f.rule);
  return {
    ...asked,
    findings: [...asked.findings.map((f) => counted.get(f.id) ?? f), ...full.findings.filter(evidenceOnly)],
    ignored: [...asked.ignored.map((f) => counted.get(f.id) ?? f), ...full.ignored.filter(evidenceOnly)],
  };
}

/**
 * The rules a recheck of one rule's finding runs: the rule, and the rules it defers to (capacity leaves a caller to
 * the waiting checks when they run). Rules turned off stay off, so the finding comes out as the full check had it.
 */
export function recheckRules(rule: CheckRuleId): CheckRuleId[] {
  if (rule === "retry-budget" || rule === "call-breaker") return [rule, "retry-storm"];
  return rule === "capacity" ? ["capacity", ...WAIT_RULES] : [rule];
}

/** Warnings first, then rule order, then reading order (`rank`), then id: the order every list of findings uses. */
export function findingOrder(rank: (id: string) => number): (a: Finding, b: Finding) => number {
  const rule = (f: Finding) => CHECK_RULES.indexOf(f.rule);
  return (a, b) =>
    Number(a.severity === "suggestion") - Number(b.severity === "suggestion") ||
    rule(a) - rule(b) ||
    rank(a.target) - rank(b.target) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "2 warnings, 3 suggestions; 1 ignored; 1 check off." or "Nothing to check. 8 checks ran." A result with findings it
 * couldn't list says so ("; 2191 more call-timeout findings not listed") and is never "Nothing to check".
 */
export function summarize(result: CheckResult): string {
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  const suggestions = result.findings.length - warnings;
  const extra = [
    ...(result.notChecked?.retryStorm
      ? [`${result.notChecked.retryStorm} retried calls not checked for retry storms`]
      : []),
    ...(result.omitted ?? []).map((o) => `${o.count} more ${o.rule} finding${o.count === 1 ? "" : "s"} not listed`),
    result.ignored.length ? `${result.ignored.length} ignored` : "",
    result.off.length ? `${plural(result.off.length, "check")} off` : "",
  ].filter(Boolean);
  const head =
    result.findings.length || result.omitted?.length || result.notChecked?.retryStorm
      ? `${plural(warnings, "warning")}, ${plural(suggestions, "suggestion")}`
      : `Nothing to check. ${plural(result.ran.length, "check")} ran`;
  return `${[head, ...extra].join("; ")}.`;
}
