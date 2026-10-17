import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import type { EdgeStyle } from "../../harness/edgeStyles";
import { motionMs } from "../../lib/motion";
import { type Viewport } from "../geometry/fit";
import { useKeepSelectionInView } from "../useOverlayFit";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { FIT } from "./fitOptions";
import type { CameraCore } from "./useCameraCore";

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
  /** Counts explicit Inspector opens (double-click, Enter, Properties). */
  inspectorRequest: number;
  nothingSelected: boolean;
  /** The open menu, if any (pane work waits for it to close). */
  menu: unknown;
  settledEmpty: boolean;
  live: boolean;
  presenting: boolean;
}

/**
 * The pane policy: the Inspector, the stencils, the AI panel or a sheet resize changed the canvas pane. A panel
 * change refits a fitted view; a selection keeps itself in view with a pan (never a zoom).
 */
export function usePaneCamera(
  wrapper: RefObject<HTMLDivElement | null>,
  routing: { style: EdgeStyle; direction: "LR" | "TB" },
  {
    camera,
    overlayFit,
    inspectorPanCommand,
    fitEpoch,
  }: Pick<CameraCore, "camera" | "overlayFit" | "inspectorPanCommand" | "fitEpoch">,
  keepInViewRef: RefObject<() => Viewport | null>,
  p: PaneInputs,
) {
  const { getNodes, getNodesBounds, getViewport, setCenter } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { paletteHidden, aiDock, inspectorHidden, sheetResize, nodes, edges, inspectorRequest, nothingSelected } = p;
  const { menu, settledEmpty, live, presenting } = p;
  // Below ROOMY the inspector opens with a selection and narrows the canvas: keep the selection
  // and its edges in view (a pan, never a zoom), once the pane has its new size.
  const keepSelectionInView = useKeepSelectionInView(wrapper, routing);
  useLayoutEffect(() => {
    keepInViewRef.current = () => keepSelectionInView(250, true);
  });
  // The Checks card opened over a diagram that was all in view: refit it clear of the card (the card is floating
  // chrome, data-canvas-overlay), once the card has drawn. A view the user panned or zoomed stays put.
  const checksMounted = () => {
    if (camera.owner !== "fit" || live || presenting) return;
    overlayFit({ maxZoom: FIT.maxZoom, margin: 40, duration: 250 });
  };
  // Record the cause independently of deferred execution: menus suspend panel work,
  // while a new selection replaces it with a reveal that never changes zoom or ownership.
  const dockKey = `${paletteHidden}:${aiDock.open}:${aiDock.open ? Math.round(aiDock.width / 40) : 0}:${inspectorHidden}:${sheetResize}`;
  const panelKey = `${paletteHidden}:${aiDock.open}:${aiDock.open ? Math.round(aiDock.width / 40) : 0}:${p.inspectorPref}:${p.inspectorByHand}:${sheetResize}:${p.livePanelOpen}:${p.narrow}:${p.cramped}`;
  const selectionKey = JSON.stringify([
    ...nodes.filter((n) => n.selected).map((n) => n.id),
    ...edges.filter((e) => e.selected).map((e) => e.id),
  ]);
  const previousPane = useRef({ dockKey, panelKey, selectionKey, inspectorRequest });
  const paneChange = useRef<"panel" | "selection">("panel");
  const pendingPane = useRef(false);
  const readPaneChange = useCallback(() => paneChange.current, []);
  useLayoutEffect(() => {
    const previous = previousPane.current;
    const selection =
      inspectorRequest !== previous.inspectorRequest || (selectionKey !== previous.selectionKey && !nothingSelected);
    if (
      (selection && pendingPane.current) ||
      inspectorRequest !== previous.inspectorRequest ||
      dockKey !== previous.dockKey
    ) {
      paneChange.current = selection || panelKey === previous.panelKey ? "selection" : "panel";
      pendingPane.current = true;
    }
    previousPane.current = { dockKey, panelKey, selectionKey, inspectorRequest };
  }, [dockKey, panelKey, selectionKey, inspectorRequest, nothingSelected]);
  useEffect(() => {
    if (!pendingPane.current || menu) return;
    // Live owns panel refits; selection reveals use the same rule in both modes.
    if (presenting || (live && paneChange.current === "panel")) {
      pendingPane.current = false;
      return;
    }
    // After React Flow's ResizeObserver has the new pane size, and once a drag on the dock's edge settles.
    const host = wrapper.current;
    host?.setAttribute("data-pane-pending", "true");
    let stopWaiting = () => {};
    const adjust = () => {
      const measured = store.getState();
      // A held/late ResizeObserver must not let the reveal consume the old pane.
      // Subscribe to delivered measurements rather than guessing how many frames they need.
      if (!host || measured.width !== host.clientWidth || measured.height !== host.clientHeight) return;
      if (
        getNodes().some(
          (n) => n.selected && !n.hidden && !(n.type === "boundary" && (!n.width || !n.height)) && !n.measured?.width,
        )
      )
        return;
      stopWaiting();
      // Cleanup can cancel this timer when a menu opens. Keep the pane change pending
      // until it runs, so closing the menu retries it using the current camera owner.
      pendingPane.current = false;
      host?.removeAttribute("data-pane-pending");
      if (paneChange.current === "panel" && camera.owner === "fit")
        return overlayFit({ maxZoom: FIT.maxZoom, margin: 40, duration: 250 });
      // Shift+2 already refines against the new pane. A pan here would interrupt
      // that transition at an intermediate zoom and invalidate its refinement.
      if (inspectorPanCommand.current === fitEpoch.current) return;
      if (keepSelectionInView(250, paneChange.current === "selection") || paneChange.current === "selection") return;
      const pane = wrapper.current?.getBoundingClientRect();
      const nodes = getNodes().filter((n) => !n.hidden);
      if (!pane || !nodes.length) return;
      const b = getNodesBounds(nodes);
      const { x, y, zoom } = getViewport();
      const cx = (b.x + b.width / 2) * zoom + x;
      const cy = (b.y + b.height / 2) * zoom + y;
      if (cx < 40 || cx > pane.width - 40 || cy < 40 || cy > pane.height - 40)
        void setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom, duration: motionMs(250) });
    };
    const id = setTimeout(() => {
      stopWaiting = store.subscribe(adjust);
      adjust();
    }, 150);
    return () => {
      clearTimeout(id);
      stopWaiting();
      host?.removeAttribute("data-pane-pending");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the dock changes the pane
  }, [dockKey, menu, selectionKey, inspectorRequest, settledEmpty, live, presenting]);
  /** Live's manual pane changes: the selection stays in view, unless Zoom to selection owns the view. */
  const onManualPaneChange = () => {
    if (inspectorPanCommand.current !== fitEpoch.current) keepSelectionInView();
  };
  return { checksMounted, readPaneChange, onManualPaneChange };
}
