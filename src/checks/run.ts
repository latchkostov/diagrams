import type { DiagramFile } from "../model/types";
import { CHECK_RULES, isCheckRule, type CheckRuleId } from "../model/checks";
import { buildContext } from "./context";
import type { CheckResult, CheckRule, Finding } from "./types";
import { deadLetter } from "./rules/deadLetter";
import { noReader } from "./rules/noReader";
import { syncCycle } from "./rules/syncCycle";
import { syncChain } from "./rules/syncChain";
import { sharedDatabase } from "./rules/sharedDatabase";
import { entryGateway } from "./rules/entryGateway";
import { capacity } from "./rules/capacity";
import { singlePoint } from "./rules/singlePoint";
import { secretIdentity } from "./rules/secretIdentity";
import { schemaRegistry } from "./rules/schemaRegistry";
import { dropped } from "./rules/dropped";

/**
 * Every rule, in CHECK_RULES order (the order findings list them). `dropped` is raised only by Run simulations
 * (src/checks/evidence.ts): it's here for its name and About, and never runs in `runChecks`.
 */
export const RULES: readonly CheckRule[] = [
  deadLetter,
  noReader,
  syncCycle,
  syncChain,
  sharedDatabase,
  entryGateway,
  capacity,
  singlePoint,
  secretIdentity,
  schemaRegistry,
  dropped,
];

export interface RunOptions {
  /** Only these rules (default: all). Rules turned off in the diagram stay off. */
  rules?: readonly CheckRuleId[];
}

/**
 * Runs the checks on a diagram. Pure and deterministic: the same diagram gives the same findings in the
 * same order. Honours the file's `checks`: turned-off rules don't run, ignored findings are set apart.
 * Scenario sizing is the exception in the editor: there it comes only from the checks worker
 * (src/lib/scenarioPlanner.ts), so a diagram the worker hasn't planned yet has no sizing finding until it has.
 */
export function runChecks(diagram: DiagramFile, opts: RunOptions = {}): CheckResult {
  const off = (diagram.checks?.off ?? []).filter(isCheckRule);
  const ran = RULES.filter((r) => !r.onDemand && !off.includes(r.id) && (!opts.rules || opts.rules.includes(r.id))).map(
    (r) => r.id,
  );
  const ctx = buildContext(diagram);
  const all = RULES.filter((r) => ran.includes(r.id)).flatMap((r) => r.detect(ctx));
  const ignores = new Set((diagram.checks?.ignore ?? []).map((i) => `${i.rule}:${i.target}`));
  all.sort(findingOrder(ctx.rank));
  return {
    findings: all.filter((f) => !ignores.has(f.id)),
    ignored: all.filter((f) => ignores.has(f.id)),
    off: CHECK_RULES.filter((id) => off.includes(id)),
    ran,
  };
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

/** "2 warnings, 3 suggestions; 1 ignored; 1 check off." or "Nothing to check. 8 checks ran." */
export function summarize(result: CheckResult): string {
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  const suggestions = result.findings.length - warnings;
  const extra = [
    result.ignored.length ? `${result.ignored.length} ignored` : "",
    result.off.length ? `${plural(result.off.length, "check")} off` : "",
  ].filter(Boolean);
  const head = result.findings.length
    ? `${plural(warnings, "warning")}, ${plural(suggestions, "suggestion")}`
    : `Nothing to check. ${plural(result.ran.length, "check")} ran`;
  return `${[head, ...extra].join("; ")}.`;
}
