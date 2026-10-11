import { memo, type CSSProperties } from "react";
import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import { InlineInput } from "../../components/InlineInput";
import { useDiagram } from "../DiagramContext";
import type { GroupFlowNode, GroupTone } from "../types";

export const toneColor: Record<GroupTone, string> = {
  azure: "#2f80ed",
  aws: "#f08c00",
  gcp: "#1e9e5a",
  k8s: "#6c5ce7",
  onprem: "#64748b",
  neutral: "#8a94a6",
};

export const toneLabel: Record<GroupTone, string> = {
  azure: "Azure",
  aws: "AWS",
  gcp: "Google Cloud",
  k8s: "Kubernetes",
  onprem: "On-premises",
  neutral: "Neutral",
};

/** Boundary box (cloud, cluster, network) drawn behind nodes. Dragged by its label. */
function GroupNodeImpl({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const { editing, setEditing } = useDiagram();
  const { updateNodeData } = useReactFlow();
  const isEditing = editing?.kind === "group" && editing.id === data.groupId;
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
      <div
        className="grp-label grp-drag"
        data-testid={`group-label-${data.groupId}`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing({ kind: "group", id: data.groupId });
        }}
      >
        <span className="grp-swatch" />
        {isEditing ? (
          <InlineInput
            value={data.label}
            placeholder="Boundary name"
            testId="group-label-input"
            onDone={(next) => {
              setEditing(null);
              if (next !== null && next.trim()) updateNodeData(id, { label: next.trim() });
            }}
          />
        ) : (
          data.label
        )}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
