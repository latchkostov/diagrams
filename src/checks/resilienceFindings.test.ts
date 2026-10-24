import { afterEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import storm from "../examples/retry-storm.json";
import payment from "../examples/slow-payment-provider.json";
import { buildContext } from "./context";
import { computeResilienceFindings, RESILIENCE_RULES, resilienceRules } from "./resilienceFindings";
import { requestChecksNeeded } from "../lib/requestCheckCache";
import * as replay from "../live/resilienceFixPlan";
import * as topology from "../sim/topology";
import { runChecks, summarize } from "./run";
import { agentReport } from "./report";
import { applyOps } from "../ai";
import { RECOMMENDED_RETRY } from "../sim/resiliencePresets";
import { presentFinding } from "./presentation";
import { FINDINGS_BUDGET } from "./findingBudget";

afterEach(() => vi.restoreAllMocks());
const diagram = () => structuredClone(storm) as DiagramFile;
const findings = (d: DiagramFile) => computeResilienceFindings(buildContext(d));
const noReplay = () => vi.spyOn(replay, "confirmedResilienceFix").mockReturnValue(undefined);

it("finds naive retries on both public lessons and applies the shared presets without losing call settings", () => {
  noReplay();
  const d = diagram(),
    original = structuredClone(d.edges.find((e) => e.id === "pay")!.props!.caller);
  const all = findings(d);
  expect(all.map((f) => f.rule)).toEqual(
    expect.arrayContaining(["retry-backoff", "retry-budget", "retry-idempotency"]),
  );
  for (const id of ["retry-backoff", "retry-budget", "retry-idempotency"] as const) {
    const f = all.find((f) => f.rule === id)!;
    expect(presentFinding(f).title).toBe(f.title);
    const result = applyOps(d, f.fix!.ops!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fix refused");
    const caller = result.diagram.edges.find((e) => e.id === "pay")!.props!.caller;
    expect(caller).toMatchObject({ wait: (original as { wait: string }).wait, deadlineMs: 300 });
    const after = findings(result.diagram);
    expect(after.some((f) => f.rule === id)).toBe(false);
    if (id === "retry-budget") expect(caller).toMatchObject({ retry: { budget: RECOMMENDED_RETRY.budget } });
    if (id === "retry-idempotency") {
      const option = applyOps(d, f.fix!.options![0].ops);
      expect(option.ok && findings(option.diagram).some((f) => f.rule === id)).toBe(false);
    }
  }
  const b = structuredClone(payment) as DiagramFile;
  b.edges.find((e) => e.id === "pay")!.props!.caller = {
    retry: { maxAttempts: 3, backoffMs: 0, strategy: "fixed", retryOn: ["timeout"] },
  };
  expect(findings(b).map((f) => f.rule)).toEqual(
    expect.arrayContaining(["retry-backoff", "retry-budget", "call-breaker"]),
  );
});

it("honours revision, active Requests, retry count, method inference and explicit idempotency", () => {
  noReplay();
  for (const change of [
    (d: DiagramFile) => {
      d.planning!.revision = "p3-w1";
    },
    (d: DiagramFile) => {
      d.edges.find((e) => e.id === "pay")!.kind = "async";
    },
    (d: DiagramFile) => {
      d.edges.find((e) => e.id === "pay")!.props!.share = 0;
    },
    (d: DiagramFile) => {
      d.edges.find((e) => e.id === "pay")!.relation = "depends";
    },
  ]) {
    const d = diagram();
    change(d);
    expect(findings(d).filter((f) => !f.unchecked)).toEqual([]);
  }
  const d = diagram(),
    e = d.edges.find((e) => e.id === "pay")!;
  e.props!.caller = { retry: { ...RECOMMENDED_RETRY, maxAttempts: 2, budget: undefined, idempotent: true } };
  const list = findings(d);
  expect(list.find((f) => f.rule === "retry-budget")?.severity).toBe("suggestion");
  expect(list.some((f) => f.rule === "retry-idempotency")).toBe(false);
  e.props!.caller = { retry: { ...RECOMMENDED_RETRY, maxAttempts: 1 } };
  expect(findings(d).filter((f) => !f.unchecked)).toEqual([]);
});

it("older revisions never request resilience worker results or read disabled waiting checks", () => {
  const d = diagram();
  d.planning!.revision = "p3-w1";
  d.checks = { off: ["blocked-threads", "scaling-blind", "call-timeout"] };
  expect(requestChecksNeeded(d)).toBe(false);
  expect(requestChecksNeeded(d, RESILIENCE_RULES)).toBe(false);
  const read = vi.fn(() => []);
  for (const rule of resilienceRules(read)) expect(rule.detect(buildContext(d))).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});

it("multiplies retry layers, limits only inner attempts, and handles cycles without recursion", () => {
  noReplay();
  const d = diagram();
  const outer = d.edges.find((e) => e.id === "request") ?? d.edges[0];
  outer.props = { caller: { retry: { ...RECOMMENDED_RETRY, maxAttempts: 5 } } };
  const f = findings(d).find((f) => f.rule === "retry-layers")!;
  expect(f.resilienceFinding).toMatchObject({ layers: 2, amplification: 15 });
  const changed = applyOps(d, f.fix!.ops!);
  expect(changed.ok && findings(changed.diagram).some((f) => f.rule === "retry-layers")).toBe(false);
  d.edges.push({ id: "cycle", from: "payments", to: "checkout", kind: "sync" });
  expect(() => findings(d)).not.toThrow();
});

it("uses configured capacity and deadline headroom for shedding, and never invents a queue fix", () => {
  noReplay();
  const d = diagram();
  d.nodes.find((n) => n.id === "payments")!.props!.concurrency = 1;
  const f = findings(d).find((f) => f.rule === "queue-limit")!;
  expect(f.resilienceFinding).toMatchObject({ deadlineMs: 300, maxWaitMs: 200, queueLimit: 10 });
  const changed = applyOps(d, f.fix!.ops!);
  expect(changed.ok && findings(changed.diagram).some((f) => f.rule === "queue-limit")).toBe(false);
  d.edges.find((e) => e.id === "pay")!.props!.caller = { deadlineMs: 50 };
  expect(findings(d).find((f) => f.rule === "queue-limit")?.fix).toBeUndefined();
});

it("compiles one static topology across all resilience rules and configured capacity", () => {
  noReplay();
  const compile = vi.spyOn(topology, "compileTopology");
  findings(diagram());
  expect(compile).toHaveBeenCalledTimes(1);
});

it("probes the highest amplification first, caps at three, and reports refused or skipped probes as incomplete", () => {
  const probe = noReplay(),
    d = diagram();
  const base = d.edges.find((e) => e.id === "pay")!;
  for (let i = 0; i < 5; i++)
    d.edges.push({
      ...base,
      id: `extra-${i}`,
      props: { caller: { retry: { ...RECOMMENDED_RETRY, maxAttempts: i + 2 } } },
    });
  const all = findings(d);
  expect(probe).toHaveBeenCalledTimes(3);
  expect(probe.mock.calls[0][0].edge).toBe("extra-4");
  const result = runChecks(d, { rules: RESILIENCE_RULES, requests: all });
  expect(result.notChecked).toEqual({ retryStorm: 6 });
  expect(summarize(result)).toContain("6 retried calls not checked");
  expect(agentReport(result).notChecked).toEqual({ retryStorm: 6 });
  const stormOnly = runChecks(d, { rules: ["retry-storm"], requests: all });
  expect(summarize(stormOnly)).not.toContain("Nothing to check");
});

it("breaks equal probe priorities by stable ID order, independent of host language", () => {
  const probe = noReplay(),
    d = diagram(),
    call = d.edges.find((e) => e.id === "pay")!;
  d.edges = d.edges.filter((e) => e.id !== call.id);
  for (const id of ["ä", "z", "Z"]) d.edges.push({ ...call, id });
  findings(d);
  expect(probe.mock.calls.map(([request]) => request.edge)).toEqual(["Z", "z", "ä"]);
});

it("bounds untrusted names and output characters, with omission counts instead of an all-clear", () => {
  noReplay();
  const d = diagram(),
    edge = d.edges.find((e) => e.id === "pay")!;
  d.nodes.forEach((n) => {
    n.label = "x".repeat(10000);
  });
  d.edges = Array.from({ length: 500 }, (_, i) => ({ ...edge, id: `call-${i}` }));
  const all = findings(d);
  expect(JSON.stringify(all).length).toBeLessThan(FINDINGS_BUDGET);
  expect(all.some((f) => f.omitted)).toBe(true);
  expect(all.filter((f) => f.resilienceFinding).every((f) => f.resilienceFinding!.callee.length <= 200)).toBe(true);
  expect(
    JSON.stringify(agentReport(runChecks(d, { rules: RESILIENCE_RULES, requests: all }))).length,
  ).toBeLessThanOrEqual(1500);
});
