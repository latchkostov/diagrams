import { memo, type CSSProperties } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useDiagram } from "../DiagramContext";
import type { GroupFlowNode } from "../types";

import { toneColor } from "../groupTones";

/** Boundary box (cloud, cluster, network) drawn behind nodes. Dragged by its label; a double-click names it. */
function GroupNodeImpl({ data, selected }: NodeProps<GroupFlowNode>) {
  const { rename, boundaryResized } = useDiagram();
  return (
    <div
      className={`grp${selected ? " is-selected" : ""}`}
      style={{ "--tone": toneColor[data.tone] ?? toneColor.neutral } as CSSProperties}
      data-testid={`group-${data.groupId}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        rename?.({ kind: "group", id: data.groupId });
      }}
    >
      <svg className="grp-outline" width="100%" height="100%" aria-hidden data-testid={`group-outline-${data.groupId}`}>
        <rect width="100%" height="100%" rx={20} fill="none" stroke="transparent" strokeWidth={8} />
      </svg>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        lineClassName="grp-resize-line"
        handleClassName="grp-resize-handle"
        onResizeEnd={boundaryResized ? () => boundaryResized(data.groupId) : undefined}
      />
      <div className="grp-label grp-drag" data-testid={`group-label-${data.groupId}`}>
        <span className="grp-swatch" />
        {data.label}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
