import { useCallback, useEffect, useRef, type DragEvent } from "react";
import type { Placing } from "../interaction";
import type { ReactFlowInstance } from "@xyflow/react";
import type { AnnotationKind } from "../../model/types";
import type { EditorApi } from "../../editor/types";
import { getNodeVariant, type NodeVariantId } from "../../harness/nodeVariants";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { ANNOTATION_DND_MIME, parseAnnotationDrag } from "../annotations";
import { STENCIL_DND_MIME } from "../../lib/canvasBridge";
import { connectHitAt, connectTarget } from "../gestures";
import { landing } from "../landing";
import type { EdgeHover } from "../edgeHover";
import type { useRevealSelection } from "../camera";

export function useRailPlacement(
  editGestures: boolean,
  insertHover: () => EdgeHover,
  annotationKindOf: (id: string) => AnnotationKind | undefined,
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"],
  nodeVariant: NodeVariantId,
  controller: Placing,
  editor: EditorApi,
  revealSelection: ReturnType<typeof useRevealSelection>["revealSelection"],
) {
  // ---------------------------------------------------------------- dropping a stencil (D13)
  // While a stencil is dragged over the canvas: over empty canvas, a faint outline where it will land; over
  // a node, the node lights up (the drop goes after it, connected); held over an edge, the edge lights up
  // (the drop goes in between, D8).
  const railDrop = useRef<{ hover: EdgeHover; node: Element | null } | null>(null);
  const endRailDrop = useCallback(() => {
    const r = railDrop.current;
    railDrop.current = null;
    r?.hover.clear();
    r?.node?.classList.remove("is-connect-target");
    landing.set(null);
  }, []);
  useEffect(() => endRailDrop, [endRailDrop]);
  /** The node a stencil dropped here would follow (one that takes edges), if any. */
  const dropNodeAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const t = connectTarget(connectHitAt(el, annotationKindOf), "");
    return t.kind === "node" ? { id: t.id, el: el?.closest(".react-flow__node") ?? null } : null;
  };
  const onRailDragOver = (e: DragEvent) => {
    if (!editGestures) return;
    const r = (railDrop.current ??= { hover: insertHover(), node: null });
    const over = dropNodeAt(e.clientX, e.clientY);
    if (over?.el !== r.node) {
      r.node?.classList.remove("is-connect-target");
      over?.el?.classList.add("is-connect-target");
      r.node = over?.el ?? null;
    }
    r.hover.at(e.clientX, e.clientY, !!over || e.ctrlKey || e.metaKey);
    if (over) return landing.set(null);
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const { width, height } = getNodeVariant(nodeVariant).size;
    landing.set({
      x: Math.round((p.x - width / 2) / 10) * 10,
      y: Math.round((p.y - height / 2) / 10) * 10,
      width,
      height,
    });
  };

  const onDrop = (e: DragEvent) => {
    const into = railDrop.current?.hover.lit() ?? null;
    endRailDrop();
    const note = parseAnnotationDrag(e.dataTransfer.getData(ANNOTATION_DND_MIME));
    if (note) {
      e.preventDefault();
      controller.placing();
      editor.addAnnotation(note.kind, {
        shape: note.shape,
        at: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
        aroundSelection: false,
      });
      return;
    }
    const id = e.dataTransfer.getData(STENCIL_DND_MIME);
    if (!id) return;
    e.preventDefault();
    const after = editGestures ? dropNodeAt(e.clientX, e.clientY) : null;
    controller.placing();
    // Onto a node: after it, connected (as a rail click does with it selected).
    if (after && editor.createConnected({ from: after.id, stencil: id })) return revealSelection();
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Held over an edge: in between, where it was dropped.
    if (into && !(e.ctrlKey || e.metaKey) && editor.insertNode(into, id, at)) return;
    // Anywhere else: where it was dropped, moved clear if it landed on something.
    const made = editor.addNode(id, at);
    requestAnimationFrame(() => editor.keepClear({ nodeIds: [made] }));
  };
  return [onRailDragOver, endRailDrop, onDrop] as const;
}
