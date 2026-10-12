import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Handle, useReactFlow, type NodeProps } from "@xyflow/react";
import { FALLBACK_STENCIL, getStencil } from "../../stencils/registry";
import { getNodeVariant } from "../../harness/nodeVariants";
import { useSettings } from "../../harness/settings";
import { useSelectOnMount } from "../../components/useSelectOnMount";
import { editKeyAction, refocusAfterEdit } from "../../components/editKeys";
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
            const label = next.label.trim() || data.label;
            const sublabel = next.sublabel.trim() || undefined;
            // Unchanged (Esc or Enter straight away): nothing to write, so nothing re-renders or resets.
            if (label !== data.label || sublabel !== (data.sublabel || undefined))
              updateNodeData(id, { label, sublabel });
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
  onDone: (next: { label: string; sublabel: string }) => void;
}) {
  const [l, setL] = useState(label);
  const [s, setS] = useState(sublabel);
  const [onSubtitle, setOnSubtitle] = useState(focus === "sublabel");
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const finish = (next: { label: string; sublabel: string }) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  useSelectOnMount(focus === "sublabel" ? second : first, typed ? "end" : "all");
  useLayoutEffect(() => keepInPane(root.current), []);
  // Every editor's keys (editKeys.ts): Enter and Esc save, Tab goes from Label to Subtitle and saves there.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const isFirst = e.currentTarget === first.current;
    const action = editKeyAction(e.nativeEvent, { hasNext: isFirst, hasPrev: !isFirst });
    if (!action) return;
    e.preventDefault();
    if (action === "next") return second.current?.select();
    if (action === "prev") return first.current?.select();
    const back = root.current?.closest(".react-flow__node");
    finish({ label: l, sublabel: s });
    refocusAfterEdit(back);
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
        onFocus={() => setOnSubtitle(false)}
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
        onFocus={() => setOnSubtitle(true)}
        placeholder="Subtitle, e.g. orders.created"
        aria-label="Subtitle"
        className="mono"
        name="sublabel"
        data-testid="node-editor-sublabel"
      />
      <div className="dn-editor-hint" data-testid="node-editor-hint">
        {onSubtitle ? "Enter saves" : "Enter saves · Tab: subtitle"}
      </div>
    </div>
  );
}

/**
 * The editor reads at its CSS size at any zoom, so zoomed out it's wider than its card: it moves left to
 * stay inside the canvas pane (never under the inspector), and opens above the card near the bottom.
 */
function keepInPane(el: HTMLElement | null) {
  const pane = el?.closest(".react-flow")?.getBoundingClientRect();
  if (!el || !pane) return;
  const M = 8;
  let r = el.getBoundingClientRect();
  if (r.bottom > pane.bottom - M && r.top - r.height - (el.parentElement?.offsetHeight ?? 0) > pane.top + M) {
    el.classList.add("is-above");
    r = el.getBoundingClientRect();
  }
  const dx = r.right > pane.right - M ? pane.right - M - r.right : r.left < pane.left + M ? pane.left + M - r.left : 0;
  // `translate` applies outside the editor's own scale: in the card's px, which the zoom scales.
  const card = el.parentElement;
  const zoom = card ? card.getBoundingClientRect().width / card.offsetWidth || 1 : 1;
  if (dx) el.style.translate = `${dx / zoom}px 0`;
}

export const DiagramNode = memo(DiagramNodeImpl);
