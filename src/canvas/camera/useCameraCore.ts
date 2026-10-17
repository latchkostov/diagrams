import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useNodesInitialized, useReactFlow, useStoreApi } from "@xyflow/react";
import type { EdgeStyle } from "../../harness/edgeStyles";
import { createCameraOwnership } from "../cameraOwnership";
import { useMeasuredTask } from "../useMeasuredTask";
import { useOverlayFit } from "../useOverlayFit";
import type { DiagramFlowEdge, FlowNode } from "../types";

/**
 * The canvas camera's core: the overlay-aware fit with its measured refinement, the interruption of
 * pending and running fits by input, and camera ownership.
 */
export function useCameraCore(
  wrapper: RefObject<HTMLDivElement | null>,
  nodes: FlowNode[],
  edges: DiagramFlowEdge[],
  typography: string,
  routing: { style: EdgeStyle; direction: "LR" | "TB" },
) {
  const { getViewport, setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  // Fit-view keeps content out from under the title card, minimap, controls and live bar.
  const fitView_ = useOverlayFit(wrapper, routing);
  const {
    request: afterMeasured,
    whenReady,
    interrupt: interruptMeasuredFit,
  } = useMeasuredTask(wrapper, nodes, edges, typography);
  const [openingFitDone, setOpeningFitDone] = useState(false);
  const fitEpoch = useRef(0);
  const inspectorPanCommand = useRef(-1);
  const earlyFit = useRef<(() => void) | null>(null);
  const fitStarting = useRef<object | null>(null);
  const fitTransition = useRef<object | null>(null);
  const interruptFit = useCallback(() => {
    fitEpoch.current++;
    earlyFit.current = null;
    interruptMeasuredFit();
    // React Flow's bootstrap waits for initial measurements too. It shares viewport
    // ownership with our immediate/refinement fits, including before the first delivery.
    const queued = store.getState();
    if (queued.fitViewQueued) {
      store.setState({ fitViewQueued: false, fitViewOptions: undefined, fitViewResolver: null });
      queued.fitViewResolver?.resolve(false);
    }
    if (fitTransition.current) {
      fitTransition.current = null;
      // Stop an already-started refinement too, before the press reaches its target.
      const own = {};
      fitStarting.current = own;
      void setViewport(getViewport()).then(() => {
        if (fitStarting.current === own) fitStarting.current = null;
      });
    }
    setOpeningFitDone(true);
  }, [getViewport, interruptMeasuredFit, setViewport, store]);
  useEffect(() => {
    // Capture input before React Flow, a portal menu or a keyboard command handles it.
    // Cancelling a refinement does not turn a fitted view into a manually panned one.
    window.addEventListener("pointerdown", interruptFit, true);
    window.addEventListener("wheel", interruptFit, { capture: true, passive: true });
    window.addEventListener("keydown", interruptFit, true);
    window.addEventListener("contextmenu", interruptFit, true);
    return () => {
      window.removeEventListener("pointerdown", interruptFit, true);
      window.removeEventListener("wheel", interruptFit, true);
      window.removeEventListener("keydown", interruptFit, true);
      window.removeEventListener("contextmenu", interruptFit, true);
    };
  }, [interruptFit]);
  const firstFit = useRef(false);
  /** Eligibility for this canvas's pending measurement refinements; camera owns pane-change policy. */
  const showingAll = useRef(true);
  const [camera] = useState(createCameraOwnership);
  const overlayFit = useCallback(
    (o?: Parameters<typeof fitView_>[0], animate = false, wholeDiagram = true) => {
      const epoch = fitEpoch.current;
      const claim = camera.claim(wholeDiagram ? "fit" : "manual");
      showingAll.current = wholeDiagram;
      const runFit = () => {
        if (epoch !== fitEpoch.current || showingAll.current !== wholeDiagram || !camera.isCurrent(claim)) return;
        firstFit.current = true;
        const own = {};
        fitStarting.current = own;
        fitTransition.current = own;
        const finished = fitView_(o);
        // Checks run independently of fonts/measurements. Their optional warning row arrives
        // after the opening viewport is computed, whichever asynchronous result wins the race.
        setOpeningFitDone(true);
        void Promise.resolve(finished).then(() => {
          if (fitStarting.current === own) fitStarting.current = null;
          if (fitTransition.current === own) fitTransition.current = null;
        });
        return finished;
      };
      // Fit the committed geometry now. Fonts/chrome readiness only refines this view;
      // it must never leave an interactive canvas at its default transform.
      const immediate = (duration: number) => {
        if (epoch !== fitEpoch.current || showingAll.current !== wholeDiagram || !camera.isCurrent(claim)) return;
        const own = {};
        fitStarting.current = own;
        fitTransition.current = own;
        void Promise.resolve(fitView_({ ...o, duration })).then(() => {
          if (fitStarting.current === own) fitStarting.current = null;
          if (fitTransition.current === own) fitTransition.current = null;
        });
      };
      earlyFit.current = () => immediate(0);
      immediate(animate ? (o?.duration ?? 0) : 0);
      afterMeasured(() => {
        if (epoch !== fitEpoch.current || showingAll.current !== wholeDiagram || !camera.isCurrent(claim)) return;
        earlyFit.current = null;
        return runFit();
      });
    },
    [afterMeasured, fitView_, camera],
  );
  const nodesInitialized = useNodesInitialized();
  useLayoutEffect(() => {
    // React Flow's initial measurements and document commands can commit after the
    // request. Apply their known geometry before paint, without waiting for fonts.
    earlyFit.current?.();
  }, [nodes, edges, nodesInitialized]);
  useLayoutEffect(() => {
    // Controlled nodes/edges enter React Flow in its passive StoreUpdater effect,
    // after our layout effect. Fit that commit before its new positions paint too.
    // Pane-only changes are deliberately excluded: they are not document commits.
    let previous = store.getState();
    return store.subscribe((state) => {
      const changed = state.nodes !== previous.nodes || state.edges !== previous.edges;
      previous = state;
      if (changed) earlyFit.current?.();
    });
  }, [store]);
  const fit = useCallback(() => {
    overlayFit({ maxZoom: 1.25, duration: 300 }, true);
  }, [overlayFit]);
  /** The zoom buttons: the view is the user's now. */
  const zoomedByButton = useCallback(() => {
    camera.claim("manual");
    showingAll.current = false;
  }, [camera]);
  /** A node drag starting: it stops any fit, and the view is the user's now. */
  const userMoved = useCallback(() => {
    interruptFit();
    camera.claim("manual");
    showingAll.current = false;
  }, [interruptFit, camera]);
  /** Shift+0 and other keyboard camera commands: the view is the user's now. */
  const claimManual = () => {
    camera.claim("manual");
  };
  // Zoom to selection: never past 125% (no huge single node), clear of the panels.
  // Refine after pane measurements too: a pending Inspector reveal must not
  // overwrite Shift+2 with its earlier selection pan at the old zoom.
  const zoomToSelection = (only: ReadonlySet<string>, onlyEdges: ReadonlySet<string>) => {
    inspectorPanCommand.current = fitEpoch.current;
    overlayFit({ only, onlyEdges, maxZoom: 1.25, margin: 64, duration: 300 }, true, false);
  };
  return {
    afterMeasured,
    whenReady,
    openingFitDone,
    fitEpoch,
    inspectorPanCommand,
    earlyFit,
    fitStarting,
    firstFit,
    showingAll,
    camera,
    interruptFit,
    overlayFit,
    fit,
    zoomedByButton,
    userMoved,
    claimManual,
    zoomToSelection,
  };
}

export type CameraCore = ReturnType<typeof useCameraCore>;
