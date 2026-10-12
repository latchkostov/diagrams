import { memo, type CSSProperties } from "react";
import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import { InlineInput } from "../../components/InlineInput";
import { useDiagram } from "../DiagramContext";
import type { GroupFlowNode } from "../types";

import { toneColor } from "../groupTones";

/** Boundary box (cloud, cluster, network) drawn behind nodes. Dragged by its label. */
function GroupNodeImpl({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const { editing, setEditing } = useDiagram();
  const { updateNodeData } = useReactFlow();
  const isEditing = editing?.kind === "group" && editing.id === data.groupId;
  return (
    <div
      className={`grp${selected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`}
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
            returnFocus={() => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)}
            onDone={(next) => {
              setEditing(null);
              if (next?.trim() && next.trim() !== data.label) updateNodeData(id, { label: next.trim() });
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
