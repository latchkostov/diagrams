import { useCallback, useLayoutEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import type { EditorApi } from "../../editor/types";
import { connectedMenuPlacement, type ConnectedMenuAnchor } from "../geometry/connectedMenuPlacement";
import { type Viewport } from "../geometry/fit";
import type { Rect } from "../geometry/rect";
import type { DiagramFlowEdge, FlowNode } from "../types";
import type { CameraController } from "./controller";
import type { RevealCause } from "./types";

/**
 * Brings the selection into view (a pan, never a zoom) once React Flow has measured it, clear of the
 * floating chrome (minimap, controls, hint), after running `then`: a copy, a paste or a node added from a
 * dropped connection may land off screen, under the inspector its selection opens, or under the
 * minimap. `roomBelow` keeps space for what hangs under the card (its label editor): screen px up to 100%
 * zoom (the editor never reads smaller than its CSS size), growing with the zoom above it.
 */
export function useRevealSelection(controller: CameraController) {
  const revealSelection = useCallback(
    (then?: () => void, roomBelow = 0, cause: RevealCause = "placement") =>
      void controller.whenSelectionMeasured(() => {
        // The editor opens at once (keys typed next belong to it); the view follows meanwhile.
        then?.();
        controller.dispatch({
          type: "reveal.requested",
          cause,
          scope: { kind: "selection", withEdges: false, roomBelow },
        });
      }),
    [controller],
  );
  return { revealSelection };
}

/**
 * Quick-add opens beside the outline of where the node will land. First the view pans, if it must, to show
 * the node, the outline and the menu's room; returns where the view lands.
 */
export function panForConnectedMenu(
  controller: CameraController,
  connected: ConnectedMenuAnchor,
  view: Viewport,
  bounds: Rect,
): Viewport | null {
  const { viewport: next } = connectedMenuPlacement(connected, view, bounds);
  controller.anchor(next);
  return next;
}

/**
 * A check's row or chip: selects the nodes and connections it names and brings them into view with the one
 * reveal (revealPan), clear of the Checks card and the other floating chrome.
 */
export function useRevealIds(controller: CameraController, editor: EditorApi) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  return useCallback(
    (ids: readonly string[]) => {
      // From React Flow's lookups: one finding may name thousands of things, and the editor's getNode/getEdge
      // each rebuild the file.
      const st = store.getState();
      const nodeIds = ids.filter((id) => st.nodeLookup.get(id)?.type === "diagram");
      const edgeIds = ids.filter((id) => st.edgeLookup.has(id));
      editor.select({ nodeIds, edgeIds, groupIds: [] });
      // Once the selection has drawn.
      controller.whenSelectionMeasured(() => {
        const now = store.getState();
        const ends = edgeIds.flatMap((id) => {
          const e = now.edgeLookup.get(id);
          return e ? [e.source, e.target] : [];
        });
        controller.dispatch({
          type: "reveal.requested",
          cause: "checks",
          scope: { kind: "nodes", ids: [...nodeIds, ...ends] },
        });
      });
    },
    [controller, editor, store],
  );
}

/**
 * Keyboard focus that lands on a node out of view or under the chrome (Tab into the canvas, a screen reader's
 * focus) brings it into view with a pan: the same reveal as a new selection (revealPan). The canvas can't
 * scroll (overflow: clip in canvas.css), and React Flow's own pan on focus only moves for a node wholly
 * outside the pane. A boundary too big for the pane keeps its name in view.
 */
export function useRevealFocused(controller: CameraController) {
  const revealFocused = useRef((_id: string, _target: HTMLElement) => {});
  useLayoutEffect(() => {
    revealFocused.current = (id, target) =>
      controller.dispatch({ type: "reveal.requested", cause: "focus", scope: { kind: "focus", id, target } });
  });
  return revealFocused;
}
