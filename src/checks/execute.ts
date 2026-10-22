import type { DiagramFile } from "../model/types";
import { planScaling, type ScalingPlan } from "../sim/scalingPlanner";
import { buildContext, type CheckContext } from "./context";
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
 * A context for checking here (the checks worker, or the editor's main thread where there's no worker). Scenario
 * sizing plays the saved simulations, so it's worked out only when a check reads it: the capacity check, or a blocked
 * caller's verified fix (never for a diagram with capacity off and no such fix).
 */
function localContext(diagram: DiagramFile): { context: CheckContext; planned(): ScalingPlan[] | undefined } {
  const context = buildContext(diagram);
  context.local = true;
  let plans: ScalingPlan[] | undefined;
  context.plans = () => (plans ??= planScaling(diagram));
  return { context, planned: () => plans };
}

/**
 * The checks as the checks worker runs them, and as the editor's main thread runs them where there's no worker: one
 * path. One context, so request findings and the other checks share one capacity analysis.
 */
export function executeChecks(diagram: DiagramFile): CheckRun {
  const { context, planned } = localContext(diagram);
  const requests = requestFindings(context);
  const result = runChecks(diagram, { context, requests });
  const plans = planned();
  return { result, requests, ...(plans ? { plans } : {}) };
}

/**
 * Request findings only, for a reader waiting on them (an agent's check, a fix): no other rule runs, and scenario
 * sizing only if a blocked caller's verified fix reads it.
 */
export function executeRequestChecks(diagram: DiagramFile): Omit<CheckRun, "result"> {
  const { context, planned } = localContext(diagram);
  const requests = requestFindings(context);
  const plans = planned();
  return { requests, ...(plans ? { plans } : {}) };
}
