import { useLayoutEffect, useRef } from "react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import type { CameraController } from "./controller";
import type { MenuKind } from "./types";

/** What changes the canvas pane: its side panels, and the selection that opens the Inspector. */
export interface PaneInputs {
  paletteHidden: boolean;
  aiDock: { open: boolean; width: number };
  inspectorHidden: boolean;
  sheetResize: number;
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
  /** The open menu's kind, if any (pane work waits for it to close). */
  menu: MenuKind | null;
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
  const { menu, live, presenting } = p;
  // The Checks card opened over a diagram that was all in view: refit it clear of the card (the card is floating
  // chrome, data-canvas-overlay), once the card has drawn. A view the user panned or zoomed stays put.
  const checksMounted = () => controller.dispatch({ type: "overlay.opened" });
  const dock = `${paletteHidden}:${aiDock.open}:${aiDock.open ? Math.round(aiDock.width / 40) : 0}`;
  /** The pane's geometry. */
  const dockKey = `${dock}:${inspectorHidden}:${sheetResize}`;
  /** The panels' own state: when it changes with the pane, the cause is the panel. */
  const panelKey = `${dock}:${p.inspectorPref}:${p.inspectorByHand}:${sheetResize}:${p.livePanelOpen}:${p.narrow}:${p.cramped}`;
  const selectionKey = JSON.stringify([
    ...nodes.filter((n) => n.selected).map((n) => n.id),
    ...edges.filter((e) => e.selected).map((e) => e.id),
  ]);
  const modeKey = `${live}:${presenting}`;
  const previousPane = useRef({ dockKey, panelKey, selectionKey, inspectorRequest, modeKey });
  const previousMenu = useRef<MenuKind | null>(null);
  useLayoutEffect(() => {
    if (menu === previousMenu.current) return;
    if (previousMenu.current) controller.dispatch({ type: "menu.closed" });
    if (menu) controller.dispatch({ type: "menu.opened", kind: menu });
    previousMenu.current = menu;
  }, [controller, menu]);
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
    else if (selected) controller.dispatch({ type: "selection.changed", cause });
  });
  /** What caused the latest pane change, for Live's own panel refits. */
  const readPaneChange = () => (controller.state.lastCause === "panel" ? "panel" : "selection");
  /** Live's manual pane changes: the selection and its connections stay in view (unless Shift+2 owns it). */
  const onManualPaneChange = () =>
    controller.dispatch({
      type: "reveal.requested",
      cause: "panel",
      scope: { kind: "selection", withEdges: true, roomBelow: 0 },
    });
  return { checksMounted, readPaneChange, onManualPaneChange };
}
