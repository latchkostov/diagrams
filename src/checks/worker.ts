// The checks off the main thread: the canvas posts the diagram after edits pause, and this worker runs the
// rules (capacity's fixed point can take a few hundred milliseconds on a big diagram with a feedback loop),
// so typing and dragging never wait on them. Same engine, same result as the main-thread fallback.

import type { DiagramFile } from "../model/types";
import { runChecks } from "./run";
import type { CheckResult } from "./types";
import { planScaling, type ScalingPlan } from "../sim/scalingPlanner";

export interface CheckRequest {
  id: number;
  diagram: DiagramFile;
  /** Scenario sizing only (live playback): the same memoized planner the capacity check uses. */
  plan?: true;
}
export type CheckResponse =
  | { id: number; result: CheckResult; plans?: ScalingPlan[] }
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
    if (plan) scope.postMessage({ id, plans: planScaling(diagram) });
    else {
      // The capacity check's plans go back with its result (memoized: no second run), for main-thread readers.
      // A diagram with capacity turned off plans nothing.
      const result = runChecks(diagram);
      scope.postMessage({ id, result, plans: result.ran.includes("capacity") ? planScaling(diagram) : undefined });
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
