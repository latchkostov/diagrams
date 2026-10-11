import { useEffect, useLayoutEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { EditorApi } from "../editor/types";
import { publish } from "./host";

// The canvas half of the palette host. Kept apart from ./host so the palette itself never pulls in
// React Flow: only the canvas (which already has it) imports this file.

const GAP_X = 80;
const GAP_Y = 40;
const MAX_TRIES = 12;

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Where a node connected from `from` goes: one gap downstream (right for LR, below for TB),
 * stepping across until the spot is free. Returns the new node's centre.
 */
export function placeNextTo(
  from: Box,
  size: { width: number; height: number },
  others: readonly Box[],
  direction: "LR" | "TB" = "LR",
): { x: number; y: number } {
  const down = direction === "TB";
  let x = down ? from.x + from.width / 2 - size.width / 2 : from.x + from.width + GAP_X;
  let y = down ? from.y + from.height + GAP_Y * 2 : from.y + from.height / 2 - size.height / 2;
  for (let i = 0; i < MAX_TRIES; i++) {
    const box = { x, y, ...size };
    if (!others.some((o) => overlaps(box, o))) break;
    if (down) x += size.width + GAP_X / 2;
    else y += size.height + GAP_Y;
  }
  return { x: x + size.width / 2, y: y + size.height / 2 };
}

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
        void rfRef.current.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration: 300 });
      },
      addStencil(stencilId) {
        const sel = editor.getSelection();
        const fromId = sel.nodeIds.length === 1 && !sel.edgeIds.length ? sel.nodeIds[0] : undefined;
        const from = fromId ? boxOf(fromId) : null;
        if (!fromId || !from) return editor.addNode(stencilId);
        const others = rfRef.current
          .getNodes()
          .filter((n) => n.type !== "boundary")
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
