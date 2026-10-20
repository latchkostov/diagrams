import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { EditorApi } from "../editor/types";
import { paletteHost, publish, type CanvasHost } from "./host";
import { placeNextTo, type Box } from "../canvas/placement";

// The canvas half of the palette host. Kept apart from ./host so the palette itself never pulls in
// React Flow: only the canvas (which already has it) imports this file.

export { placeNextTo };

/** Called by the canvas (inside its ReactFlowProvider) to publish itself to the palette. */
export function useCanvasHost(
  editor: EditorApi,
  opts: {
    live: boolean;
    enabled: boolean;
    localOnly?: boolean;
    private?: boolean;
    onDevice?: boolean;
    /** Stable (a callback keyed on the diagram): it's a dependency of the published host. */
    allowOnDevice?: (on: boolean) => void;
    documentId?: string;
    revision?: unknown;
    /** The canvas camera's go-to: the node centred at a readable zoom (the view is the user's after it). */
    goTo?: (id: string) => void;
    /**
     * The canvas's focus controller: focus goes to the node the palette went to (now), or added (once it's drawn:
     * React Flow shows a card once it's measured, and a hidden one can't take focus).
     */
    focus?: (id: string, placed: boolean) => void;
    openPicker?: CanvasHost["openPicker"];
  },
) {
  const instanceId = useId();
  const rf = useReactFlow();
  const rfRef = useRef(rf);
  useLayoutEffect(() => {
    rfRef.current = rf;
  });
  const {
    live,
    enabled,
    localOnly,
    private: isPrivate,
    onDevice,
    allowOnDevice,
    documentId,
    revision,
    goTo,
    focus,
    openPicker,
  } = opts;
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
    const off = publish("canvas", {
      editor,
      instanceId,
      live,
      localOnly,
      private: isPrivate,
      onDevice,
      allowOnDevice,
      documentId,
      openPicker,
      focusNode(id) {
        const box = boxOf(id);
        editor.select({ nodeIds: [id] });
        if (!box) return;
        goTo?.(id);
        focus?.(id, false);
      },
      // With one node selected the stencil goes after it, connected (the rail does the same). Keyboard first:
      // the new node takes focus once drawn, so Enter names it and Alt+arrow grows the flow from it.
      addStencil: (stencilId) => {
        const id = editor.addStencil(stencilId);
        focus?.(id, true);
        return id;
      },
    });
    paletteHost.activateRun();
    return off;
  }, [
    editor,
    instanceId,
    live,
    enabled,
    localOnly,
    isPrivate,
    onDevice,
    allowOnDevice,
    documentId,
    revision,
    goTo,
    focus,
    openPicker,
  ]);
}
