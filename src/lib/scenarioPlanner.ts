import type { DiagramFile } from "../model/types";
import type { ScalingPlan } from "../sim/scalingPlanner";
import { simulationContent } from "../sim/simulationContent";

/**
 * Where the editor gets scenario sizing. Planning plays simulations, so in the editor it runs only in the checks
 * worker: the editor registers that planner, and every result it returns (and every background check's) is
 * remembered here by the content a simulation sees. Main-thread readers (agent tools, Copy prompt, a fix's
 * re-check) read only those results: they never run a simulation themselves. With nothing registered (headless
 * tools, tests, the worker itself) the planner runs where it's called. Exported files register nothing.
 */
let planner: ((d: DiagramFile) => Promise<ScalingPlan[]>) | undefined;
const remembered = new Map<string, ScalingPlan[]>();

export function registerScenarioPlanner(fn: ((d: DiagramFile) => Promise<ScalingPlan[]>) | undefined): void {
  planner = fn;
  remembered.clear();
}
/** The off-thread planner, remembering what it returns; undefined when nothing is registered. */
export function scenarioPlanner(): ((d: DiagramFile) => Promise<ScalingPlan[]>) | undefined {
  const fn = planner;
  if (!fn) return undefined;
  return async (d) => {
    const key = simulationContent(d);
    const plans = await fn(d);
    remember(key, plans);
    return plans;
  };
}
/** A result worked out off the main thread for `d` (a background check's), for main-thread readers. */
export function rememberPlans(d: DiagramFile, plans: ScalingPlan[]): void {
  if (planner) remember(simulationContent(d), plans);
}
function remember(key: string, plans: ScalingPlan[]) {
  remembered.delete(key);
  if (remembered.size >= 8) remembered.delete(remembered.keys().next().value!);
  remembered.set(key, plans);
}
/**
 * In the editor: `{ plans }` already worked out off-thread for exactly this content (undefined: not yet).
 * Undefined when nothing is registered: the caller plans here.
 */
export function offThreadPlans(d: DiagramFile): { plans?: ScalingPlan[] } | undefined {
  return planner ? { plans: remembered.get(simulationContent(d)) } : undefined;
}
