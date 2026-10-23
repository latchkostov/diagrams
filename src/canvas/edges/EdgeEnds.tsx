import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { ViewportPortal, useReactFlow, useStoreApi } from "@xyflow/react";
import { useDiagram } from "../DiagramContext";
import { connectionAt, connectionMarks, requestDots } from "../interaction/connectDots";
import type { EdgeEnd } from "../../editor/edgeEdits";
import type { AnnotationKind } from "../../model/types";
import type { FlowNode } from "../types";
import { useInteraction } from "../interaction/useInteraction";
import { usePointerGesture } from "../interaction/usePointerGesture";

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
  const flow = useReactFlow<FlowNode>();
  const { getNode } = flow;
  const store = useStoreApi<FlowNode>();
  const interaction = useInteraction();
  const active = useSyncExternalStore(
    interaction?.subscribe ?? noSubscribe,
    () => interaction?.getEdgePreview(id) ?? null,
  );
  const drag = active?.kind === "edge.end" && active.edge === id ? { which: active.end, at: active.at } : null;
  const pointerGesture = usePointerGesture();
  if (!reconnect) return null;

  const begin = (which: EdgeEnd) => (e: ReactPointerEvent) => {
    const wrap = e.currentTarget.closest(".canvas-wrap");
    const fixed = which === "source" ? target : source;
    const moving = which === "source" ? source : target;
    const kindOf = (nid: string) => {
      const n = getNode(nid);
      return n?.type === "annotation" ? (n.data as { kind: AnnotationKind }).kind : undefined;
    };
    requestDots(true);
    const marks = connectionMarks(wrap);
    pointerGesture(e, {
      kind: "edge.end",
      activationDistance: 3,
      preview(_at, screen) {
        const hit = connectionAt(screen, fixed, flow, store.getState().nodeLookup.values(), kindOf);
        const t = hit.target;
        marks.show(t);
        return {
          kind: "edge.end",
          edge: id,
          end: which,
          at: hit.at,
          over: t.kind === "node" ? { node: t.id, side: t.side } : null,
        };
      },
      commit(p) {
        if (p.kind === "edge.end" && p.over && (p.over.node !== moving || p.over.side))
          reconnect(id, which, p.over.node, p.over.side);
      },
      clean: marks.clear,
    });
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

const noSubscribe = () => () => {};
