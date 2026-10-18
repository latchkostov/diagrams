import { createContext, useContext, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useNodesInitialized, useReactFlow, useStoreApi } from "@xyflow/react";
import type { EdgeStyle } from "../../harness/edgeStyles";
import { motionMs } from "../../lib/motion";
import { createCameraOwnership, type CameraOwnership } from "../cameraOwnership";
import { useRoutingOptions, type RouteOptions } from "../edges/useEdgeRoute";
import { useMeasuredTask } from "../useMeasuredTask";
import type { DiagramFlowEdge, FlowNode } from "../types";
import {
  createCameraController,
  type CameraController,
  type CameraPort,
  type MoveHandle,
  type MoveStatus,
} from "./controller";
import type { Viewport } from "../geometry/fit";
import {
  centerViewport,
  focusBoxes,
  goToViewport,
  liveFitViewport,
  nodeBoxes,
  noteFitViewport,
  overlayFitViewport,
  revealPan,
  selectionBoxes,
  zoomAboutCentre,
} from "./geometry";
import { cameraJournal } from "./journal";

/** The canvas's camera, for what renders inside the canvas (quick-add's menu, the HTML viewer's controls). */
export const CameraContext = createContext<CameraController | null>(null);
export const useCameraController = () => useContext(CameraContext);

/**
 * The canvas camera's core: the controller (the single writer of the viewport) with its React Flow port, the
 * measured gate its fits refine on, input interrupting fits, and camera ownership (shared with Live).
 */
export function useCameraCore(
  wrapper: RefObject<HTMLDivElement | null>,
  nodes: FlowNode[],
  edges: DiagramFlowEdge[],
  typography: string,
  routing: { style: EdgeStyle; direction: "LR" | "TB" },
) {
  const { setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const routingOptions = useRoutingOptions(routing);
  const gate = useMeasuredTask(wrapper, nodes, edges, typography);
  const [openingFitDone, setOpeningFitDone] = useState(false);
  const [camera] = useState(createCameraOwnership);
  const [{ controller, api, attach }] = useState(() =>
    createCanvasCamera(store, setViewport, gate, camera, () => setOpeningFitDone(true)),
  );
  useLayoutEffect(() => attach(wrapper.current, routingOptions));
  useEffect(() => {
    // Capture input before React Flow, a portal menu or a keyboard command handles it.
    // Cancelling a refinement does not turn a fitted view into a manually panned one.
    const press = () => controller.input("press");
    const release = () => controller.input("release");
    const other = () => controller.input();
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    window.addEventListener("wheel", other, { capture: true, passive: true });
    window.addEventListener("keydown", other, true);
    window.addEventListener("contextmenu", other, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
      window.removeEventListener("wheel", other, true);
      window.removeEventListener("keydown", other, true);
      window.removeEventListener("contextmenu", other, true);
    };
  }, [controller]);
  useEffect(() => controller.connect(), [controller]);
  const nodesInitialized = useNodesInitialized();
  useLayoutEffect(() => {
    // React Flow's initial measurements and document commands can commit after the
    // request. Apply their known geometry before paint, without waiting for fonts.
    controller.committed();
  }, [controller, nodes, edges, nodesInitialized]);
  useLayoutEffect(() => {
    // Controlled nodes/edges enter React Flow in its passive StoreUpdater effect,
    // after our layout effect. Fit that commit before its new positions paint too.
    // Pane-only changes are deliberately excluded: they are not document commits.
    let previous = store.getState();
    return store.subscribe((state) => {
      const changed = state.nodes !== previous.nodes || state.edges !== previous.edges;
      previous = state;
      if (changed) controller.committed();
    });
  }, [store, controller]);
  return { whenReady: gate.whenReady, openingFitDone, camera, controller, ...api };
}

export type CameraCore = ReturnType<typeof useCameraCore>;

type Store = ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;

/**
 * The controller with its port onto React Flow and the canvas element. The element and the routing options
 * arrive with attach(), after each commit.
 */
function createCanvasCamera(
  store: Store,
  setViewport: ReturnType<typeof useReactFlow<FlowNode, DiagramFlowEdge>>["setViewport"],
  gate: ReturnType<typeof useMeasuredTask>,
  camera: CameraOwnership,
  fitted: () => void,
) {
  let root: HTMLElement | null = null;
  let routing: RouteOptions | null = null;
  const transform = () => {
    const [x, y, zoom] = store.getState().transform;
    return { x, y, zoom };
  };
  const selectionMeasured = () => {
    for (const n of store.getState().nodeLookup.values())
      if (n.selected && !n.hidden && !(n.type === "boundary" && (!n.width || !n.height)) && !n.measured?.width)
        return false;
    return true;
  };
  let ownPending = false;
  const port: CameraPort = {
    viewport: transform,
    move: (target, o) => canvasMove(store, setViewport, target, o),
    fitTarget: (request) => (root && routing ? overlayFitViewport(root, store.getState(), routing, request) : null),
    revealTarget(base, scope) {
      const el = root;
      if (!el) return null;
      const s = store.getState();
      if (scope.kind === "nodes") {
        const want = nodeBoxes(s, scope.ids);
        return want ? revealPan(el, base, want) : null;
      }
      if (scope.kind === "focus") {
        // The label's screen box converts at the view it was drawn with.
        const f = focusBoxes(el, s, scope.id, scope.target, transform());
        return f ? revealPan(el, base, f.card, f.must) : null;
      }
      if (!routing) return null;
      const b = selectionBoxes(s, routing, { ...scope, zoom: base.zoom });
      return b ? revealPan(el, base, b.want, b.core) : null;
    },
    centerTarget: (base) => (root ? centerViewport(root, store.getState(), base) : null),
    goToTarget: (base, id) => (root ? goToViewport(root, store.getState(), base, id) : null),
    liveFitTarget: (room) => liveFitViewport(store.getState(), room),
    noteFitTarget: (focus, room) => noteFitViewport(store.getState(), focus, room),
    zoomTarget(base, zoom) {
      const { minZoom, maxZoom } = store.getState();
      const k = Math.min(maxZoom, Math.max(minZoom, zoom));
      return root ? zoomAboutCentre(root, base, k) : null;
    },
    paneSample: () => (root ? paneSample(store.getState(), root, selectionMeasured) : null),
    selectionMeasured,
    hasSelection: () => {
      const s = store.getState();
      return s.nodes.some((n) => n.selected && !n.hidden) || s.edges.some((e) => e.selected && !e.hidden);
    },
    afterMeasured: (run) => gate.request(run),
    interruptMeasured: () => gate.interrupt(),
    cancelBootstrapFit() {
      // React Flow's bootstrap waits for initial measurements too. It shares viewport
      // ownership with our immediate/refinement fits, including before the first delivery.
      const queued = store.getState();
      if (!queued.fitViewQueued) return;
      store.setState({ fitViewQueued: false, fitViewOptions: undefined, fitViewResolver: null });
      queued.fitViewResolver?.resolve(false);
    },
    publish(phase, panePending) {
      const el = root;
      if (!el) return;
      el.dataset.cameraState = phase;
      // Live marks its own panel refits on the same element: only take back what this set.
      if (panePending) el.setAttribute("data-pane-pending", "true");
      else if (ownPending) el.removeAttribute("data-pane-pending");
      ownPending = panePending;
    },
    fitted,
  };
  const controller = createCameraController(
    port,
    {
      frame(run) {
        const id = requestAnimationFrame(run);
        return () => cancelAnimationFrame(id);
      },
    },
    camera,
    { motion: motionMs, journal: cameraJournal },
  );
  const api = {
    fit: () => controller.dispatch({ type: "fit", reason: "command" }),
    reset: () => controller.dispatch({ type: "fit", reason: "reset" }),
    zoom100: () => controller.dispatch({ type: "zoom100" }),
    zoomToSelection: (nodes: ReadonlySet<string>, edges: ReadonlySet<string>) =>
      controller.dispatch({ type: "zoomToSelection", nodes, edges }),
    /** The zoom buttons: the view is the user's now. */
    zoomedByButton: () => controller.userMoved(),
    /** A node drag starting: it stops any fit, and the view is the user's now. */
    dragStarted: () => controller.dragStarted(),
    interruptFit: () => controller.interrupt(),
  };
  return {
    controller,
    api,
    attach(el: HTMLElement | null, options: RouteOptions) {
      root = el;
      routing = options;
    },
  };
}

/** d3-transition's schedule for one transition (d3-transition/src/transition/schedule.js). */
interface D3Schedule {
  state: number;
}

/**
 * The newest d3 transition on React Flow's zoom pane. React Flow never says when d3 stops a transition (another
 * move interrupts it, or cancels it before it starts): its promise just never resolves. d3 keeps each element's
 * transitions in `__transition`, by increasing id, until they end.
 */
function newestTransition(root: HTMLElement | null | undefined): D3Schedule | null {
  const pane = root?.querySelector(".react-flow__renderer") as
    (Element & { __transition?: Record<string, D3Schedule> }) | null;
  const schedules = pane?.__transition;
  if (!schedules) return null;
  let newest: number | null = null;
  for (const id of Object.keys(schedules)) if (newest === null || Number(id) > newest) newest = Number(id);
  return newest === null ? null : schedules[newest];
}

/** d3's states: CREATED 0, SCHEDULED 1, STARTING 2, STARTED 3, RUNNING 4, ENDING 5, ENDED 6. */
function transitionStatus(schedule: D3Schedule): MoveStatus {
  if (schedule.state <= 1) return "waiting";
  if (schedule.state === 2) return "starting";
  return schedule.state >= 6 ? "ended" : "running";
}

/**
 * The pane and nodes as React Flow has measured them (CameraPort.paneSample), for the element React Flow fills:
 * null until every visible node is measured (a node just added, by Live say), then a fingerprint of the pane and
 * every node's position and size, so work runs only once two frames agree on complete geometry.
 */
export function paneSample(
  s: Pick<ReturnType<Store["getState"]>, "width" | "height" | "nodeLookup">,
  el: Pick<HTMLElement, "clientWidth" | "clientHeight">,
  selectionMeasured: () => boolean,
) {
  // A held/late ResizeObserver must not let pane work consume the old pane.
  if (!s.width || s.width !== el.clientWidth || s.height !== el.clientHeight) return null;
  if (!selectionMeasured()) return null;
  let hash = 0;
  const mix = (v: number) => (hash = (Math.imul(hash, 31) + Math.round(v * 16)) | 0);
  for (const n of s.nodeLookup.values()) {
    if (n.hidden) continue;
    // React Flow never measures a boundary with an empty axis (as the measured gate allows): it has no area.
    if (!n.measured?.width || !n.measured.height) {
      if (n.type === "boundary" && (!n.width || !n.height)) continue;
      return null;
    }
    mix(n.internals.positionAbsolute.x);
    mix(n.internals.positionAbsolute.y);
    mix(n.measured.width);
    mix(n.measured.height);
  }
  return `${s.width}x${s.height}:${s.nodeLookup.size}:${hash}`;
}

/** Moves React Flow's view (CameraPort.move), with the d3 schedule's status of the move. */
export function canvasMove(
  store: Store,
  setViewport: ReturnType<typeof useReactFlow<FlowNode, DiagramFlowEdge>>["setViewport"],
  target: Viewport,
  o: { duration: number; linear: boolean },
): MoveHandle {
  const done = setViewport(target, { duration: o.duration, interpolate: o.linear ? "linear" : undefined });
  if (o.duration <= 0) return { done, status: () => "ended" };
  // setViewport schedules its d3 transition synchronously: the newest on the zoom pane is this move.
  const schedule = newestTransition(store.getState().domNode);
  return { done, status: () => (schedule ? transitionStatus(schedule) : "unknown") };
}
