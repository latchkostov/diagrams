import { useEffect, useLayoutEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { EditorApi } from "../editor/types";
import { publish } from "./host";
import { motionMs } from "../lib/motion";
import { placeNextTo, type Box } from "../canvas/placement";

// The canvas half of the palette host. Kept apart from ./host so the palette itself never pulls in
// React Flow: only the canvas (which already has it) imports this file.

export { placeNextTo };

/** Called by the canvas (inside its ReactFlowProvider) to publish itself to the palette. */
export function useCanvasHost(
  editor: EditorApi,
  opts: { live: boolean; enabled: boolean; localOnly?: boolean; documentId?: string; revision?: unknown },
) {
  const rf = useReactFlow();
  const rfRef = useRef(rf);
  useLayoutEffect(() => {
    rfRef.current = rf;
  });
  const { live, enabled, localOnly, documentId, revision } = opts;
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
      localOnly,
      documentId,
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
      // With one node selected the stencil goes after it, connected (the rail does the same). Keyboard first:
      // the new node takes focus once drawn, so Enter names it and Alt+arrow grows the flow from it.
      addStencil: (stencilId) => {
        const id = editor.addStencil(stencilId);
        let frames = 30;
        // React Flow shows a card once it's measured, and a hidden one can't take focus: try each frame.
        const focus = () => {
          const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
          el?.focus({ preventScroll: true });
          if ((!el || document.activeElement !== el) && --frames > 0) requestAnimationFrame(focus);
        };
        requestAnimationFrame(focus);
        return id;
      },
    });
  }, [editor, live, enabled, localOnly, documentId, revision]);
}
