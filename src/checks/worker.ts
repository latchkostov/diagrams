// The checks off the main thread: the canvas posts the diagram after edits pause, and this worker runs the
// rules (capacity's fixed point can take a few hundred milliseconds on a big diagram with a feedback loop),
// so typing and dragging never wait on them. Same engine, same result as the main-thread fallback.

import type { DiagramFile } from "../model/types";
import { runChecks } from "./run";
import type { CheckResult, Finding } from "./types";
import { requestFindings } from "./requestFindings";
import { buildContext } from "./context";
import { planScaling, type ScalingPlan } from "../sim/scalingPlanner";
import { confirmedThreadFix, type ThreadFixRequest } from "../live/threadFixPlan";
import type { TroubleAction } from "../live/observedTrouble";

export interface CheckRequest {
  id: number;
  diagram: DiagramFile;
  /** Scenario sizing only (live playback): the same memoized planner the capacity check uses. */
  plan?: true;
  threadFix?: ThreadFixRequest;
}
export type CheckResponse =
  | { id: number; threadFix: TroubleAction | undefined }
  | { id: number; result: CheckResult; plans?: ScalingPlan[]; requests: Finding[] }
  | { id: number; plans: ScalingPlan[] }
  | { id: number; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<CheckRequest>) => void) | null;
  postMessage(message: CheckResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, diagram, plan } = e.data;
  try {
    if (e.data.threadFix) scope.postMessage({ id, threadFix: confirmedThreadFix(e.data.threadFix) });
    else if (plan) scope.postMessage({ id, plans: planScaling(diagram) });
    else {
      // The capacity check's plans go back with its result (memoized: no second run), for main-thread readers.
      // A diagram with capacity turned off plans nothing.
      // Request findings (every one, for the shared cache) and the checks share one context: one capacity analysis.
      const context = buildContext(diagram);
      context.local = true;
      const requests = requestFindings(context);
      const result = runChecks(diagram, { context, requests });
      scope.postMessage({
        id,
        result,
        plans: result.ran.includes("capacity") ? planScaling(diagram) : undefined,
        requests,
      });
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
