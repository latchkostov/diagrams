import { expect, it, vi } from "vitest";
import storm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { buildContext } from "./context";
import { computeResilienceFindings, RESILIENCE_RULES } from "./resilienceFindings";
import { runChecks } from "./run";
import { applyOps } from "../ai";
import { THREAD_FIX_LIMITS } from "../live/threadFixPlan";
import * as headless from "../sim/headless";
import { agentReport } from "./report";

it("the configured-rate probe offers exactly one replay-proven fix, with evidence, and supersedes budget and breaker", () => {
  const d = structuredClone(storm) as DiagramFile;
  const all = computeResilienceFindings(buildContext(d));
  const f = all.find((f) => f.rule === "retry-storm" && !f.unchecked)!;
  expect(f).toBeDefined();
  expect(f.resilienceFinding).toMatchObject({
    probe: { slowdown: 5, startMs: 5000, clearMs: 10000, horizonMs: 30000 },
    replay: { step: "shedding" },
  });
  expect(f.fix?.options).toBeUndefined();
  expect(f.fix!.ops!.length).toBeGreaterThan(0);
  expect(f.resilienceFinding!.replay!.afterIntegral).toBeGreaterThanOrEqual(
    1.2 * f.resilienceFinding!.replay!.beforeIntegral,
  );
  expect(f.resilienceFinding!.replay!.recoveredAfterMs).toBeLessThanOrEqual(10000);
  const result = runChecks(d, { rules: RESILIENCE_RULES, requests: all });
  expect(result.findings.some((f) => ["retry-budget", "call-breaker"].includes(f.rule))).toBe(false);
  expect(result.findings.some((f) => f.rule === "retry-backoff")).toBe(true);
  const report = agentReport(runChecks(d, { rules: ["retry-storm"], requests: all }));
  expect(report.findings[0].resilienceFinding).toMatchObject({ replay: { step: "shedding" } });
  expect(report.findings[0].fix).toHaveProperty("ops");
  const onlyBudget = runChecks(d, { rules: ["retry-budget"], requests: all });
  expect(onlyBudget.findings[0].rule).toBe("retry-budget");
  const changed = applyOps(d, f.fix!.ops!);
  expect(changed.ok).toBe(true);
  if (changed.ok)
    expect(
      computeResilienceFindings(buildContext(changed.diagram)).some((f) => f.rule === "retry-storm" && !f.unchecked),
    ).toBe(false);
});

it("a refused baseline is not clean and a refused candidate is never offered", () => {
  const d = structuredClone(storm) as DiagramFile,
    saved = THREAD_FIX_LIMITS.messages;
  try {
    THREAD_FIX_LIMITS.messages = 0;
    const all = computeResilienceFindings(buildContext(d));
    expect(all.find((f) => f.unchecked)?.unchecked).toBe(1);
    expect(all.some((f) => f.rule === "retry-storm" && !f.unchecked)).toBe(false);
  } finally {
    THREAD_FIX_LIMITS.messages = saved;
  }
  const original = headless.createHeadlessRun;
  let count = 0;
  const spy = vi.spyOn(headless, "createHeadlessRun").mockImplementation((...args) => {
    if (++count > 1) throw new Error("refused");
    return original(...args);
  });
  try {
    const f = computeResilienceFindings(buildContext(d)).find((f) => f.rule === "retry-storm" && !f.unchecked)!;
    expect(f).toBeDefined();
    expect(f.fix).toBeUndefined();
    expect(f.message).toContain("No fix was proven");
  } finally {
    spy.mockRestore();
  }
});
