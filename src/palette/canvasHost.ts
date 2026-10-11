import { useEffect, useLayoutEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { EditorApi } from "../editor/types";
import { publish } from "./host";
import { motionMs } from "../lib/motion";
import { placeNextTo, type Box } from "../canvas/placement";
import { isConnectable, isObstacle } from "../canvas/annotations";
import type { AnnotationKind } from "../model/types";

// The canvas half of the palette host. Kept apart from ./host so the palette itself never pulls in
// React Flow: only the canvas (which already has it) imports this file.

export { placeNextTo };

/** Called by the canvas (inside its ReactFlowProvider) to publish itself to the palette. */
export function useCanvasHost(editor: EditorApi, opts: { live: boolean; enabled: boolean }) {
  const rf = useReactFlow();
  const rfRef = useRef(rf);
  useLayoutEffect(() => {
    rfRef.current = rf;
  });
  const { live, enabled } = opts;
  useEffect(() => {
    if (!enabled) return;
    const boxOf = (id: string): Box | null => {
      const n = rfRef.current.getNode(id);
      if (!n) return null;
      return {
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? n.width ?? 180,
        height: n.measured?.height ?? n.height ?? 64,
      };
    };
    return publish("canvas", {
      editor,
      live,
      focusNode(id) {
        const box = boxOf(id);
        editor.select({ nodeIds: [id] });
        if (!box) return;
        const zoom = Math.max(rfRef.current.getZoom(), 0.9);
        void rfRef.current.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration: motionMs(300) });
        document
          .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true });
      },
      addStencil(stencilId) {
        const sel = editor.getSelection();
        const one = sel.nodeIds.length === 1 && !sel.edgeIds.length ? sel.nodeIds[0] : undefined;
        // Texts, notes and zones take no edges: a new stencil just lands in view.
        const note = one ? editor.getAnnotation(one) : undefined;
        const fromId = note && !isConnectable(note.kind) ? undefined : one;
        const from = fromId ? boxOf(fromId) : null;
        if (!fromId || !from) return editor.addNode(stencilId);
        const others = rfRef.current
          .getNodes()
          .filter(
            (n) =>
              n.type !== "boundary" &&
              (n.type !== "annotation" || isObstacle((n.data as { kind: AnnotationKind }).kind)),
          )
          .map((n) => boxOf(n.id))
          .filter((b): b is Box => !!b);
        const direction = editor.getDiagram().direction === "TB" ? "TB" : "LR";
        const at = placeNextTo(from, { width: from.width, height: from.height }, others, direction);
        // Same tick: the history debounce records the node and its edge as one undo step.
        const id = editor.addNode(stencilId, at);
        editor.connect(fromId, id);
        return id;
      },
    });
  }, [editor, live, enabled]);
}
