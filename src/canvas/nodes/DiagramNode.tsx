import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Handle, useReactFlow, useStore, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { FALLBACK_STENCIL, getStencil } from "../../stencils/registry";
import { getNodeVariant } from "../../harness/nodeVariants";
import { useSettings } from "../../harness/settings";
import { useSelectOnMount } from "../../components/useSelectOnMount";
import { editKeyAction, refocusAfterEdit } from "../../components/editKeys";
import { keepInPane } from "../keepInPane";
import { useDiagram } from "../DiagramContext";
import { SIDES, sidePosition } from "../edges/routing";
import type { DiagramFlowNode } from "../types";
import { useShowDependencies } from "../dependencyVisibility";
import { DependencyPips } from "./DependencyPips";
import { GrowChip } from "./GrowChip";

/** Exactly one thing is selected (this node): only then does it show its "+". */
function onlyOne(s: ReactFlowState) {
  let n = 0;
  for (const x of s.nodes) if (x.selected && ++n > 1) return false;
  for (const e of s.edges) if (e.selected) return false;
  return n === 1;
}
const never = () => false;

/**
 * React Flow wrapper: handles + inline editing around whichever body variant is selected.
 * One handle per side, all `source` type: the canvas runs in loose connection mode, so a drag
 * can start or end on any side. Edges pick their sides from geometry (see edges/routing.ts).
 */
function DiagramNodeImpl({
  id,
  data,
  selected,
  dragging,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<DiagramFlowNode>) {
  const { nodeVariant } = useSettings();
  const { editing, setEditing, grow } = useDiagram();
  const { updateNodeData, updateEdgeData } = useReactFlow();
  const single = useStore(selected && grow ? onlyOne : never);
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
      {single && !edit && !dragging && <GrowChip id={id} x={positionAbsoluteX} y={positionAbsoluteY} />}
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
          connection={edit.edge !== undefined}
          focus={edit.field}
          onDone={(next) => {
            setEditing(null);
            const label = next.label.trim() || data.label;
            const sublabel = next.sublabel.trim() || undefined;
            // Unchanged (Esc or Enter straight away): nothing to write, so nothing re-renders or resets.
            if (label !== data.label || sublabel !== (data.sublabel || undefined))
              updateNodeData(id, { label, sublabel });
            // The same tick: naming the node and its connection is one undo step.
            const connection = next.connection.trim();
            if (edit.edge && connection) updateEdgeData(edit.edge, { label: connection });
          }}
        />
      )}
    </div>
  );
}

type EditorFields = { label: string; sublabel: string; connection: string };
const HINT = ["Enter saves · Tab: subtitle", "Enter saves", "The connection's label · Enter saves"];

function NodeEditor({
  label,
  typed = false,
  sublabel,
  connection = false,
  focus,
  onDone,
}: {
  label: string;
  /** The label was typed before the editor opened: keep typing at its end rather than replacing it. */
  typed?: boolean;
  sublabel: string;
  /** A node just made connected: a third field names its connection (Tab from the subtitle). */
  connection?: boolean;
  focus: "label" | "sublabel";
  onDone: (next: EditorFields) => void;
}) {
  const [l, setL] = useState(label);
  const [s, setS] = useState(sublabel);
  const [c, setC] = useState("");
  const [field, setField] = useState(focus === "sublabel" ? 1 : 0);
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const third = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const fields = connection ? [first, second, third] : [first, second];
  const finish = (next: EditorFields) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  useSelectOnMount(focus === "sublabel" ? second : first, typed ? "end" : "all");
  // Zoomed out it's wider than its card: it stays inside the canvas, and opens above the card near the bottom.
  useLayoutEffect(() => keepInPane(root.current, { above: () => root.current?.classList.add("is-above") }), []);
  // Every editor's keys (editKeys.ts): Enter and Esc save, Tab goes from Label to Subtitle (then, for a node
  // just made connected, to its connection's label) and saves after the last.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const i = fields.findIndex((f) => f.current === e.currentTarget);
    const action = editKeyAction(e.nativeEvent, { hasNext: i < fields.length - 1, hasPrev: i > 0 });
    if (!action) return;
    e.preventDefault();
    if (action === "next") return fields[i + 1].current?.select();
    if (action === "prev") return fields[i - 1].current?.select();
    const back = root.current?.closest(".react-flow__node");
    finish({ label: l, sublabel: s, connection: c });
    refocusAfterEdit(back);
  };
  return (
    <div
      ref={root}
      className="dn-editor nodrag nopan nowheel"
      data-testid="node-editor"
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) finish({ label: l, sublabel: s, connection: c });
      }}
    >
      <input
        ref={first}
        value={l}
        onChange={(e) => setL(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => setField(0)}
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
        onFocus={() => setField(1)}
        placeholder="Subtitle, e.g. orders.created"
        aria-label="Subtitle"
        className="mono"
        name="sublabel"
        data-testid="node-editor-sublabel"
      />
      {connection && (
        <input
          ref={third}
          value={c}
          onChange={(e) => setC(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => setField(2)}
          placeholder="Connection label, e.g. Reserve stock"
          aria-label="Connection label"
          name="connection"
          data-testid="node-editor-connection"
        />
      )}
      <div className="dn-editor-hint" data-testid="node-editor-hint">
        {connection && field === 1 ? "Enter saves · Tab: connection" : HINT[field]}
      </div>
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeImpl);
