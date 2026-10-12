import { memo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Handle, useReactFlow, type NodeProps } from "@xyflow/react";
import { FALLBACK_STENCIL, getStencil } from "../../stencils/registry";
import { getNodeVariant } from "../../harness/nodeVariants";
import { useSettings } from "../../harness/settings";
import { useSelectOnMount } from "../../components/useSelectOnMount";
import { useDiagram } from "../DiagramContext";
import { SIDES, sidePosition } from "../edges/routing";
import type { DiagramFlowNode } from "../types";
import { useShowDependencies } from "../dependencyVisibility";
import { DependencyPips } from "./DependencyPips";

/**
 * React Flow wrapper: handles + inline editing around whichever body variant is selected.
 * One handle per side, all `source` type: the canvas runs in loose connection mode, so a drag
 * can start or end on any side. Edges pick their sides from geometry (see edges/routing.ts).
 */
function DiagramNodeImpl({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { nodeVariant } = useSettings();
  const { editing, setEditing } = useDiagram();
  const { updateNodeData } = useReactFlow();
  const stencil = getStencil(data.stencil);
  const unknown = stencil === FALLBACK_STENCIL;
  const { Component } = getNodeVariant(nodeVariant);
  const edit = editing?.kind === "node" && editing.id === id ? editing : null;
  const showDeps = useShowDependencies();

  return (
    <div
      className={`dn dn-${nodeVariant}`}
      data-testid={`node-${id}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing({ kind: "node", id, field: "label" });
      }}
      style={{ "--accent": stencil.accent } as CSSProperties}
    >
      <Component stencil={stencil} label={data.label} sublabel={data.sublabel} selected={selected} unknown={unknown} />
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={sidePosition[side]}
          className="dn-handle"
          data-testid={`handle-${id}-${side}`}
        />
      ))}
      {!showDeps && <DependencyPips id={id} />}
      {unknown && (
        <div className="dn-unknown" title={`Unknown stencil "${data.stencil}"`}>
          ? {data.stencil}
        </div>
      )}
      {edit && (
        <NodeEditor
          label={edit.text ?? data.label}
          typed={edit.text !== undefined}
          sublabel={data.sublabel ?? ""}
          focus={edit.field}
          onDone={(next) => {
            setEditing(null);
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
  typed = false,
  sublabel,
  focus,
  onDone,
}: {
  label: string;
  /** The label was typed before the editor opened: keep typing at its end rather than replacing it. */
  typed?: boolean;
  sublabel: string;
  focus: "label" | "sublabel";
  onDone: (next: { label: string; sublabel: string } | null) => void;
}) {
  const [l, setL] = useState(label);
  const [s, setS] = useState(sublabel);
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const finish = (next: { label: string; sublabel: string } | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  useSelectOnMount(focus === "sublabel" ? second : first, typed ? "end" : "all");
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") finish({ label: l, sublabel: s });
    if (e.key === "Escape") finish(null);
  };
  return (
    <div
      ref={root}
      className="dn-editor nodrag nopan nowheel"
      data-testid="node-editor"
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
        ref={second}
        value={s}
        onChange={(e) => setS(e.target.value)}
        onKeyDown={onKey}
        placeholder="Subtitle, e.g. orders.created"
        aria-label="Subtitle"
        className="mono"
        name="sublabel"
        data-testid="node-editor-sublabel"
      />
      <div className="dn-editor-hint">Enter saves, Esc cancels</div>
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeImpl);
