// Architecture checks: findings and fixes as language-neutral data (ids, rules, severities, elements, ops), their
// English words in a separate golden (they are agent-facing and stay English), the agent report, each fix applied
// and re-checked, and Run simulations' evidence (the saved simulations played with a fake clock).
import { describe, it } from "vitest";
import type { DiagramFile } from "../../../src/model/types";
import { applyOps } from "../../../src/ai";
import { RULES, runChecks, summarize } from "../../../src/checks/run";
import { agentReport } from "../../../src/checks/report";
import { presentFinding } from "../../../src/checks/presentation";
import { collectEvidence } from "../../../src/checks/evidence";
import { evidenceText, withEvidence } from "../../../src/checks/evidenceMerge";
import type { CheckResult, Finding } from "../../../src/checks/types";
import { planningDiagrams as allDiagrams } from "../lib/corpus";
import { expectGolden } from "../lib/golden";

/** What a finding is, without its words. */
function neutral(f: Finding) {
  return {
    id: f.id,
    rule: f.rule,
    severity: f.severity,
    ...(f.scope ? { scope: f.scope } : {}),
    target: f.target,
    elements: f.elements,
    ...(f.brokerRationale ? { brokerRationale: f.brokerRationale } : {}),
    ...(f.brokerAssignment
      ? {
          brokerAssignment: {
            spec: f.brokerAssignment.spec,
            active: f.brokerAssignment.active,
            configured: f.brokerAssignment.configured,
          },
        }
      : {}),
    ...(f.fix
      ? {
          fix: {
            ops: f.fix.ops ?? null,
            needsChoice: f.fix.choice !== undefined,
            ...(f.fix.options ? { options: f.fix.options.map((o) => ({ kind: o.kind ?? null, ops: o.ops })) } : {}),
            ...(f.fix.brokerChanges
              ? { brokerChanges: f.fix.brokerChanges.map((c) => ({ name: c.name, spec: c.spec, count: c.count })) }
              : {}),
          },
        }
      : {}),
    ...(f.evidence ? { evidence: f.evidence } : {}),
  };
}

/** A finding's English words: what the checks panel and agents read. */
function words(f: Finding) {
  const shown = presentFinding(f);
  return {
    title: f.title,
    message: f.message,
    rationale: f.rationale,
    ...(f.fix
      ? {
          fix: {
            label: f.fix.label,
            ...(f.fix.choice !== undefined ? { choice: f.fix.choice } : {}),
            ...(f.fix.options ? { options: f.fix.options.map((o) => ({ label: o.label, short: o.short })) } : {}),
          },
        }
      : {}),
    ...(f.brokerAssignment ? { brokerAssignment: f.brokerAssignment.text } : {}),
    ...(f.fix?.brokerChanges ? { brokerChanges: f.fix.brokerChanges.map((c) => c.text) } : {}),
    // The panel's wording (presentFinding), where it differs.
    ...(shown.message !== f.message ? { shownMessage: shown.message } : {}),
    ...(shown.rationale !== f.rationale ? { shownRationale: shown.rationale } : {}),
    ...(shown.fix && shown.fix.label !== f.fix?.label ? { shownFixLabel: shown.fix.label } : {}),
  };
}

function result(r: CheckResult) {
  return { ran: r.ran, off: r.off, findings: r.findings.map(neutral), ignored: r.ignored.map(neutral) };
}

/** Each fix (and each of its options) applied through the ops core, then the checks again. */
function fixes(d: DiagramFile, r: CheckResult) {
  const out: Record<string, unknown> = {};
  for (const f of r.findings) {
    const variants = [
      ...(f.fix?.ops ? [["default", f.fix.ops] as const] : []),
      ...(f.fix?.options ?? []).map((o, i) => [`option ${i + 1}`, o.ops] as const),
    ];
    for (const [name, ops] of variants) {
      const applied = applyOps(d, ops);
      out[`${f.id} (${name})`] = {
        ok: applied.ok,
        errors: applied.errors,
        warnings: applied.warnings,
        summary: applied.summary,
        results: applied.results,
        nodes: applied.diagram.nodes.length,
        edges: applied.diagram.edges.length,
        findingsAfter: runChecks(applied.diagram).findings.map((g) => g.id),
      };
    }
  }
  return out;
}

it("rule catalogue", () => {
  expectGolden(
    "checks/rules.json",
    RULES.map((r) => ({ id: r.id, name: r.name, about: r.about, onDemand: r.onDemand ?? false })),
  );
});

describe("checks", () => {
  for (const { slug, diagram } of allDiagrams)
    it(slug, () => {
      const r = runChecks(diagram);
      expectGolden(`checks/${slug}.json`, { ...result(r), fixes: fixes(diagram, r) });
      expectGolden(`checks-words/${slug}.json`, {
        summary: summarize(r),
        findings: Object.fromEntries([...r.findings, ...r.ignored].map((f) => [f.id, words(f)])),
        agentReport: agentReport(r, "all"),
        agentReportWarnings: agentReport(r, "warnings"),
      });
    });
});

describe("run simulations", () => {
  for (const { slug, diagram } of allDiagrams.filter((d) => d.diagram.simulations?.length))
    it(slug, () => {
      // A fake clock: the wall-clock budget can't cut a simulation short on a slow machine.
      const evidence = collectEvidence(diagram, { now: () => 0 });
      const merged = withEvidence(runChecks(diagram), evidence, diagram.checks);
      expectGolden(`evidence/${slug}.json`, {
        evidence,
        planned: merged.planned,
        counted: merged.counted,
        findings: merged.result.findings.map((f) => ({
          ...neutral(f),
          ...(f.evidence ? { evidenceText: f.evidence.map(evidenceText) } : {}),
        })),
        agentReport: agentReport(merged.result, "all", { evidence, planned: merged.planned }),
      });
    });
});
