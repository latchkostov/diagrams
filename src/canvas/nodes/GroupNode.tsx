import { memo, type CSSProperties } from "react";
import { NodeResizeControl, ResizeControlVariant, type NodeProps } from "@xyflow/react";
import { useDiagram } from "../DiagramContext";
import type { GroupFlowNode } from "../types";

import { isHexColor } from "../../model/colors";
import { resolveGroupTone } from "../groupTones";

/** Boundary box (cloud, cluster, network) drawn behind nodes. Dragged by its label; a double-click names it. */
function GroupNodeImpl({ data, selected }: NodeProps<GroupFlowNode>) {
  const { rename, boundaryResized } = useDiagram();
  return (
    <div
      className={`grp${selected ? " is-selected" : ""}`}
      style={{ "--tone": resolveGroupTone(data.tone) } as CSSProperties}
      data-testid={`group-${data.groupId}`}
      data-caption-root={data.groupId}
      data-tone={isHexColor(data.tone) ? "custom" : data.tone}
      onDoubleClick={(e) => {
        e.stopPropagation();
        rename?.({ kind: "group", id: data.groupId });
      }}
    >
      <svg className="grp-outline" width="100%" height="100%" aria-hidden data-testid={`group-outline-${data.groupId}`}>
        <rect width="100%" height="100%" rx={20} fill="none" stroke="transparent" strokeWidth={8} />
      </svg>
      {selected &&
        (["top", "right", "bottom", "left", "top-left", "top-right", "bottom-left", "bottom-right"] as const).map(
          (position) => {
            const line = !position.includes("-");
            return (
              <NodeResizeControl
                key={position}
                position={position}
                variant={line ? ResizeControlVariant.Line : ResizeControlVariant.Handle}
                minWidth={160}
                minHeight={100}
                className={line ? "grp-resize-line" : "grp-resize-handle"}
                onResizeEnd={boundaryResized ? () => boundaryResized(data.groupId) : undefined}
              >
                <span className="grp-resize-hit" data-testid={`group-resize-${data.groupId}-${position}`} />
              </NodeResizeControl>
            );
          },
        )}
      <div className="grp-label grp-drag" data-testid={`group-label-${data.groupId}`}>
        <span className="grp-swatch" />
        {data.label}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
