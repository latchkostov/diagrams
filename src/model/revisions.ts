import type { PlanningModel } from "./types";

export const PLANNING_REVISIONS = ["p1", "p2", "p3", "p3-a1", "p3-w1", "p3-w2"] as const;
type Revision = PlanningModel["revision"];

/** Capabilities are cumulative; unknown revisions never silently enable execution features. */
export function revisionAtLeast(revision: unknown, minimum: Revision): boolean {
  return PLANNING_REVISIONS.indexOf(revision as Revision) >= PLANNING_REVISIONS.indexOf(minimum);
}
