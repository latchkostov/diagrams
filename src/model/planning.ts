import type { DiagramFile, PlanningModel, SimRole } from "./types";
import { stencilRole } from "../stencils/roles";
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

/** Revision-free clipboard nodes pin the same small preset values as node creation.
 * No saved runs travel with a fragment, and no profiles/evidence catalogue loads with the canvas. */
export function clipboardNodes(d: DiagramFile) {
  if (!d.planning) return d.nodes;
  return d.nodes.map((node) => {
    const props = { ...node.props };
    const role = stencilRole(node.stencil);
    const preset =
      props.presetRevision === "1" && props.preset === "device-size" && role === "gateway"
        ? deviceValues(node.stencil, props.size)
        : undefined;
    const values = { ...(role === "processor" ? PROCESSOR_VALUES : {}), ...preset, ...props };
    for (const key of ["preset", "presetRevision", "connections", "querySlots"]) Reflect.deleteProperty(values, key);
    return { ...node, props: values };
  });
}
