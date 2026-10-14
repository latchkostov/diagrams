import type { PlanningModel, SimRole } from "./types";
import { PROCESSOR_VALUES, deviceValues } from "./planningPresets";

/** New p1 processors pin the original lesson; edits remain flat node overrides. */
export function newPlanningProps(
  role: SimRole,
  planning?: PlanningModel,
  stencil?: string,
): Record<string, unknown> | undefined {
  if (planning?.revision !== "p1") return undefined;
  if (role === "processor") return { preset: "processor-lesson", presetRevision: "1", ...PROCESSOR_VALUES };
  const device = role === "gateway" ? deviceValues(stencil) : undefined;
  return device ? { preset: "device-size", presetRevision: "1", ...device } : undefined;
}
