import type { DiagramFile } from "../model/types";
import type { ScalingPlan } from "../sim/scalingPlanner";

/**
 * Where live playback gets scenario sizing: the editor registers the checks worker's planner (the same memoized
 * result the capacity check shows). Exported files register nothing, as they run no checks.
 */
let planner: ((d: DiagramFile) => Promise<ScalingPlan[]>) | undefined;
export function registerScenarioPlanner(fn: (d: DiagramFile) => Promise<ScalingPlan[]>): void {
  planner = fn;
}
export function scenarioPlanner(): ((d: DiagramFile) => Promise<ScalingPlan[]>) | undefined {
  return planner;
}
