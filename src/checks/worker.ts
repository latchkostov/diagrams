// The checks off the main thread: the canvas posts the diagram after edits pause, and this worker runs the
// rules (capacity's fixed point can take a few hundred milliseconds on a big diagram with a feedback loop),
// so typing and dragging never wait on them. Same engine, same result as the main-thread fallback.

import type { DiagramFile } from "../model/types";
import type { CheckResult, Finding } from "./types";
import { executeChecks, executeRequestChecks } from "./execute";
import { planScaling, type ScalingPlan } from "../sim/scalingPlanner";
import { confirmedThreadFix, type ThreadFixRequest } from "../live/threadFixPlan";
import type { TroubleAction } from "../live/observedTrouble";

export interface CheckRequest {
  id: number;
  diagram: DiagramFile;
  /** Scenario sizing only (live playback): the same memoized planner the capacity check uses. */
  plan?: true;
  /** Request findings only (an agent's check or a fix waiting on them): no other rule runs. */
  requests?: true;
  threadFix?: ThreadFixRequest;
}
export type CheckResponse =
  | { id: number; threadFix: TroubleAction | undefined }
  | {
      id: number;
      result: CheckResult;
      plans?: ScalingPlan[];
      /** Absent: none worked out (no enabled rule reads them). */ requests?: Finding[];
    }
  | { id: number; plans: ScalingPlan[] }
  | { id: number; requestsOnly: Finding[]; plans?: ScalingPlan[] }
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
    else if (e.data.requests) {
      const { requests, plans } = executeRequestChecks(diagram);
      scope.postMessage({ id, requestsOnly: requests, plans });
    } else {
      // Scenario sizing goes back with the result when a check read it, for main-thread readers. A diagram with
      // capacity turned off (and no blocked caller's verified fix) plans nothing.
      const { result, requests, plans } = executeChecks(diagram);
      scope.postMessage({ id, result, plans, requests });
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
