import { memo, type CSSProperties } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { GroupFlowNode, GroupTone } from "../types";

export const toneColor: Record<GroupTone, string> = {
  azure: "#2f80ed",
  aws: "#f08c00",
  gcp: "#1e9e5a",
  k8s: "#6c5ce7",
  onprem: "#64748b",
  neutral: "#8a94a6",
};

/** Boundary box (cloud, cluster, network) drawn behind nodes. Dragged by its label. */
function GroupNodeImpl({ data, selected }: NodeProps<GroupFlowNode>) {
  return (
    <div
      className={`grp${selected ? " is-selected" : ""}`}
      style={{ "--tone": toneColor[data.tone] ?? toneColor.neutral } as CSSProperties}
      data-testid={`group-${data.groupId}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        lineClassName="grp-resize-line"
        handleClassName="grp-resize-handle"
      />
      <div className="grp-label grp-drag">
        <span className="grp-swatch" />
        {data.label}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
