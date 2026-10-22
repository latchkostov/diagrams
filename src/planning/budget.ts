import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { MAX_PLANNING_WORK, planningInput } from "./workBudget";

export { MAX_PLANNING_WORK };

/** A plan's cache key, or undefined when the diagram is past the input or work ceiling (workBudget.ts). */
export function planningSignature(d: DiagramFile, state?: LiveState | null): string | undefined {
  const config = planningInput(d, state);
  return config && JSON.stringify(config);
}
