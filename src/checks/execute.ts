import type { DiagramFile } from "../model/types";
import { planScaling, type ScalingPlan } from "../sim/scalingPlanner";
import { buildContext } from "./context";
import { requestFindings } from "./requestFindings";
import { runChecks } from "./run";
import type { CheckResult, Finding } from "./types";

export interface CheckRun {
  result: CheckResult;
  /** Every request finding, rules off included: the shared cache's complete result (src/lib/requestCheckCache.ts). */
  requests: Finding[];
  /** Scenario sizing, when a check read it (for main-thread readers); absent when nothing did. */
  plans?: ScalingPlan[];
}

/**
 * The checks as the checks worker runs them, and as the editor's main thread runs them where there's no worker: one
 * path. One context, so request findings and the other checks share one capacity analysis. Scenario sizing plays
 * the saved simulations, so it's worked out only when a check reads it: the capacity check, or a blocked caller's
 * verified fix (never for a diagram with capacity off and no such fix).
 */
export function executeChecks(diagram: DiagramFile): CheckRun {
  const context = buildContext(diagram);
  context.local = true;
  let plans: ScalingPlan[] | undefined;
  context.plans = () => (plans ??= planScaling(diagram));
  const requests = requestFindings(context);
  const result = runChecks(diagram, { context, requests });
  return { result, requests, ...(plans ? { plans } : {}) };
}
