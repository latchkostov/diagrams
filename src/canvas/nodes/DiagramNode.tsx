import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { FALLBACK_STENCIL, getStencil } from "../../stencils/registry";
import { getNodeVariant } from "../../harness/nodeVariants";
import { useSettings } from "../../harness/settings";
import { useDiagram } from "../DiagramContext";
import type { DiagramFlowNode } from "../types";

/** React Flow wrapper: handles + inline editing around whichever body variant is selected. */
function DiagramNodeImpl({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { nodeVariant } = useSettings();
  const { direction } = useDiagram();
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const stencil = getStencil(data.stencil);
  const unknown = stencil === FALLBACK_STENCIL;
  const { Component } = getNodeVariant(nodeVariant);
  const [targetPos, sourcePos] =
    direction === "TB" ? [Position.Top, Position.Bottom] : [Position.Left, Position.Right];

  return (
    <div
      className={`dn dn-${nodeVariant}`}
      data-testid={`node-${id}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      style={{ "--accent": stencil.accent } as CSSProperties}
    >
      <Handle type="target" position={targetPos} className="dn-handle" />
      <Component stencil={stencil} label={data.label} sublabel={data.sublabel} selected={selected} unknown={unknown} />
      <Handle type="source" position={sourcePos} className="dn-handle" />
      {unknown && (
        <div className="dn-unknown" title={`Unknown stencil "${data.stencil}"`}>
          ? {data.stencil}
        </div>
      )}
      {editing && (
        <NodeEditor
          label={data.label}
          sublabel={data.sublabel ?? ""}
          onDone={(next) => {
            setEditing(false);
            if (next)
              updateNodeData(id, {
                label: next.label.trim() || data.label,
                sublabel: next.sublabel.trim() || undefined,
              });
          }}
        />
      )}
    </div>
  );
}

function NodeEditor({
  label,
  sublabel,
  onDone,
}: {
  label: string;
  sublabel: string;
  onDone: (next: { label: string; sublabel: string } | null) => void;
}) {
  const [l, setL] = useState(label);
  const [s, setS] = useState(sublabel);
  const first = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const finish = (next: { label: string; sublabel: string } | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  useEffect(() => {
    first.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") finish({ label: l, sublabel: s });
    if (e.key === "Escape") finish(null);
  };
  return (
    <div
      ref={root}
      className="dn-editor nodrag nopan nowheel"
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) finish({ label: l, sublabel: s });
      }}
    >
      <input
        ref={first}
        value={l}
        onChange={(e) => setL(e.target.value)}
        onKeyDown={onKey}
        placeholder="Label"
        aria-label="Label"
        name="label"
        data-testid="node-editor-label"
      />
      <input
        value={s}
        onChange={(e) => setS(e.target.value)}
        onKeyDown={onKey}
        placeholder="Sublabel, e.g. orders.created"
        aria-label="Sublabel"
        className="mono"
        name="sublabel"
        data-testid="node-editor-sublabel"
      />
      <div className="dn-editor-hint">Enter saves, Esc cancels</div>
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeImpl);
