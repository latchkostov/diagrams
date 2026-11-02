import type { ReactFlowState } from "@xyflow/react";
import type { BoxItem } from "../gestures";
import type { DiagramFlowEdge, FlowNode } from "../types";

/** Measured, absolute boxes shared by pointer and keyboard area selection. */
export function selectionBoxes(state: Pick<ReactFlowState<FlowNode, DiagramFlowEdge>, "nodeLookup">): BoxItem[] {
  return [...state.nodeLookup.values()].flatMap((n) => {
    const width = n.measured?.width ?? n.width ?? 0,
      height = n.measured?.height ?? n.height ?? 0;
    if (n.hidden || n.selectable === false || !width || !height) return [];
    return [
      {
        id: n.id,
        ...n.internals.positionAbsolute,
        width,
        height,
        backdrop: n.type === "boundary" || (n.type === "annotation" && "kind" in n.data && n.data.kind === "zone"),
      },
    ];
  });
}
