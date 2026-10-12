import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { useDiagram } from "../DiagramContext";
import { connectHitAt, connectTarget } from "../gestures";
import type { EdgeEnd } from "../../editor/edgeEdits";
import type { AnnotationKind } from "../../model/types";
import type { FlowNode } from "../types";

type Point = { x: number; y: number };

/**
 * A selected edge's two ends (D8): drag one onto another node to move that end there. The edge keeps its
 * label, relationship and settings. While dragging: the crosshair, the node a drop moves it to lit up (a
 * drop anywhere on it counts), and a dashed line from the end that stays. Dropped anywhere else (or Esc),
 * it snaps back. They sit above the nodes, at a constant size on screen.
 */
export function EdgeEnds({
  id,
  source,
  target,
  start,
  end,
}: {
  id: string;
  source: string;
  target: string;
  start: Point;
  end: Point;
}) {
  const { reconnect } = useDiagram();
  const { screenToFlowPosition, getNode } = useReactFlow<FlowNode>();
  const [drag, setDrag] = useState<{ which: EdgeEnd; at: Point } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  if (!reconnect) return null;

  const begin = (which: EdgeEnd) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    stop.current?.();
    const wrap = e.currentTarget.closest(".canvas-wrap");
    // The end that stays: a drop back on it would make a loop.
    const fixed = which === "source" ? target : source;
    const moving = which === "source" ? source : target;
    const kindOf = (nid: string) => {
      const n = getNode(nid);
      return n?.type === "annotation" ? (n.data as { kind: AnnotationKind }).kind : undefined;
    };
    let over: Element | null = null;
    let to: string | null = null;
    const mark = (el: Element | null, on: boolean) => el?.classList.toggle("is-connect-target", on);
    wrap?.classList.add("is-connecting");
    const move = (ev: PointerEvent) => {
      setDrag({ which, at: screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) });
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const t = connectTarget(connectHitAt(el, kindOf), fixed);
      const node = t.kind === "node" ? (el?.closest(".react-flow__node") ?? null) : null;
      if (node !== over) {
        mark(over, false);
        mark(node, true);
        over = node;
      }
      to = t.kind === "node" ? t.id : null;
      wrap?.classList.toggle("is-connect-invalid", t.kind === "invalid" || t.kind === "source");
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      mark(over, false);
      wrap?.classList.remove("is-connecting", "is-connect-invalid");
      stop.current = null;
      setDrag(null);
      if (commit && to && to !== moving) reconnect(id, which, to);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    stop.current = () => finish(false);
  };

  const anchor = drag ? (drag.which === "source" ? end : start) : null;
  return (
    <ViewportPortal>
      {(["source", "target"] as const).map((which) => {
        const p = which === "source" ? start : end;
        return (
          <div
            key={which}
            className={`edge-end nodrag nopan${drag?.which === which ? " is-dragging" : ""}`}
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            onPointerDown={begin(which)}
            title={which === "source" ? "Drag to start this edge from another node" : "Drag onto another node"}
            data-testid={`reconnect-${id}-${which}`}
          />
        );
      })}
      {drag && anchor && (
        <svg className="edge-end-line" aria-hidden data-testid="reconnect-line">
          <path d={`M ${anchor.x} ${anchor.y} L ${drag.at.x} ${drag.at.y}`} />
        </svg>
      )}
    </ViewportPortal>
  );
}
