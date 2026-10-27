import { useCallback, useLayoutEffect, useRef } from "react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import type { CameraController } from "./controller";
import type { SheetSnap } from "../inspector/dockState";

/** What changes the canvas pane: its side panels, and the selection that opens the Inspector. */
export interface PaneInputs {
  paletteHidden: boolean;
  aiDock: { open: boolean; width: number };
  inspectorHidden: boolean;
  sheetResize: number;
  sheetSnap: SheetSnap;
  /** The Inspector's remembered setting and whether it was opened by hand. */
  inspectorPref: boolean;
  inspectorByHand: boolean;
  livePanelOpen: boolean;
  narrow: boolean;
  cramped: boolean;
  nodes: FlowNode[];
  edges: DiagramFlowEdge[];
  /** Counts explicit Inspector opens (double-click, Enter, Properties): each is a selection cause. */
  inspectorRequest: number;
  nothingSelected: boolean;
  live: boolean;
  presenting: boolean;
}

/**
 * Tells the camera what changed the pane, and why. A change of the panels' own state (a toggle, its shortcut, the
 * View menu, the command palette, a resize, the AI panel, Live's panel) is a `panel` cause; an explicit Inspector
 * open, or the Inspector opening or folding with the selection, is a `selection` cause (a `placement` when a new
 * item was placed). The policy decides what follows; nothing here moves the view.
 */
export function usePaneCamera(controller: CameraController, p: PaneInputs) {
  const { paletteHidden, aiDock, inspectorHidden, sheetResize, nodes, edges, inspectorRequest, nothingSelected } = p;
  const { live, presenting } = p;
  // The Checks card opened over a diagram that was all in view: refit it clear of the card (the card is floating
  // chrome, data-canvas-overlay), once the card has drawn. A view the user panned or zoomed stays put.
  const checksMounted = useCallback(() => controller.dispatch({ type: "overlay.opened" }), [controller]);
  const dock = `${paletteHidden}:${aiDock.open}:${aiDock.open ? Math.round(aiDock.width / 40) : 0}`;
  /** The pane's geometry. */
  const dockKey = `${dock}:${inspectorHidden}:${sheetResize}:${p.sheetSnap}`;
  /** The panels' own state: when it changes with the pane, the cause is the panel. */
  const panelKey = `${dock}:${p.inspectorPref}:${p.inspectorByHand}:${sheetResize}:${p.sheetSnap}:${p.livePanelOpen}:${p.narrow}:${p.cramped}`;
  const selectionKey = JSON.stringify([
    ...nodes.filter((n) => n.selected).map((n) => n.id),
    ...edges.filter((e) => e.selected).map((e) => e.id),
  ]);
  const modeKey = `${live}:${presenting}`;
  const previousPane = useRef({ dockKey, panelKey, selectionKey, inspectorRequest, modeKey });
  useLayoutEffect(() => {
    const previous = previousPane.current;
    previousPane.current = { dockKey, panelKey, selectionKey, inspectorRequest, modeKey };
    const placed = controller.takePlacement();
    // A mode change fits the whole diagram for its new pane (useModeFit): no pane work on top of it.
    if (modeKey !== previous.modeKey) return;
    const explicitOpen = inspectorRequest !== previous.inspectorRequest;
    const selected = selectionKey !== previous.selectionKey && !nothingSelected;
    const cause = placed ? "placement" : "selection";
    if (dockKey !== previous.dockKey)
      controller.dispatch({
        type: "pane.changed",
        cause: explicitOpen || selected || panelKey === previous.panelKey ? cause : "panel",
      });
    else if (explicitOpen) controller.dispatch({ type: "pane.changed", cause });
    // A selection with no pane change reaches the camera as the interaction controller's selection.changed.
  });
  return { checksMounted };
}
