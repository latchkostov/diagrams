// Wires slow motion into the live view: the session (record ahead, then replay), the camera (fit the
// path once, follow only when it can't be read), the keys (Space, ← →, Esc) and the painter the
// particle renderer draws over its frozen frame. LiveView calls `frame()` from its animation loop.
// The canvas camera moves the view (src/canvas/camera, panePolicy rows W1–W7): slow motion owns it while it
// runs (owner `slowmo`; a pan by hand gives it up) and supplies the geometry, from camera.ts.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { useStoreApi } from "@xyflow/react";
import type { CameraController } from "../../canvas/camera";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { isEditableTarget } from "../../editor/shortcuts";
import type { SimSnapshot } from "../../sim/types";
import { stencilRole } from "../../stencils/roles";
import { buildJourney } from "../../trace/journey";
import type { LiveController } from "../controller";
import { LIVE_BAR_SPACE } from "../layout";
import { TRACE_CARD_FOOTPRINT, TRACE_CARD_TOP } from "../traceCardLayout";
import { isRecordingActive } from "../record/framing";
import { followPan, planCamera, type CameraPlan, type FlowBox, type Insets, type View } from "./camera";
import { SlowPainter, type PaintedLabel } from "./painter";
import { loadSlowScript, slowScript } from "./scriptChunk";
import { LOAD_FAILED, whenIdle } from "../../lib/lazyLoad";
import { notify, toast } from "../../interop/ui/toast";
import { SlowMotion, type SlowSource, type SlowState } from "./session";

type Store = ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;

/** Things that own the keys before slow motion does (menus, dialogs, side panels). */
const KEY_OWNERS = '[role="menu"], [role="dialog"], [data-testid="sim-panel"], [data-testid="capacity-panel"]';
const SELECTED = ".react-flow__node.selected, .react-flow__edge.selected";

export interface SlowMotionView {
  session: SlowMotion;
  state: SlowState;
  /** Start slow motion (saves the view to come back to). */
  start(source: SlowSource): void;
  /** Back to live: the view and play state from before. */
  end(): void;
  /** Called every animation frame: advances the replay and returns the painter to draw over live. */
  frame(wallMs: number, speed: number): SlowPainter | undefined;
  /**
   * Called at the UI clock (~8 Hz): state for React, test hooks on the canvas. `labels`: the captions
   * the renderer painted last (in the worker or here).
   */
  ui(canvas: HTMLCanvasElement, snap: SimSnapshot, labels: readonly PaintedLabel[]): void;
  /** The nodes and edges the replay visits (they stay lit; the rest dims). */
  path: { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null;
}

export function useSlowMotion(opts: {
  controller: LiveController;
  store: Store;
  camera: CameraController;
  presenting: boolean;
  reducedMotion: boolean;
  /** A side panel covers the right of the pane. */
  panelOpen: boolean;
  /** A recording is being captured: the trace card is hidden, so the fit can use its room. */
  capturing: boolean;
}): SlowMotionView {
  const { controller, store, camera, presenting, reducedMotion, panelOpen, capturing } = opts;
  const live = useRef({ reducedMotion, panelOpen, capturing, presenting });
  useLayoutEffect(() => {
    live.current = { reducedMotion, panelOpen, capturing, presenting };
  }, [reducedMotion, panelOpen, capturing, presenting]);
  const plan = useRef<CameraPlan | null>(null);
  /** A paused replay whose pane changed holds its view at this time, until play, a seek or a step. */
  const pausedPaneAt = useRef<number | null>(null);
  const before = useRef<View | null>(null);
  const [painter] = useState(() => new SlowPainter());

  /** The pane minus the title and the bar (and a side panel). */
  const insets = useCallback((): Insets => {
    const right = live.current.panelOpen ? 440 : 48;
    return { top: 110, right, bottom: 48 + LIVE_BAR_SPACE, left: 48 };
  }, []);
  /** The trace card's first rows (top right), which the fit keeps clear; none while recording. */
  const overlays = useCallback((): FlowBox[] => {
    const l = live.current;
    if (l.panelOpen || l.capturing) return [];
    const width = l.presenting ? 392 : 352;
    return [{ x: store.getState().width - 16 - width, y: TRACE_CARD_TOP, width, height: TRACE_CARD_FOOTPRINT }];
  }, [store]);
  const boxes = useCallback(
    (ids: Iterable<string>): FlowBox[] => {
      const lookup = store.getState().nodeLookup;
      const out: FlowBox[] = [];
      for (const id of ids) {
        const n = lookup.get(id);
        if (!n || n.hidden || !n.measured.width) continue;
        const { x, y } = n.internals.positionAbsolute;
        out.push({ x, y, width: n.measured.width ?? 0, height: n.measured.height ?? 0 });
      }
      return out;
    },
    [store],
  );
  const pane = useCallback(() => ({ width: store.getState().width, height: store.getState().height }), [store]);

  const [session] = useState(() => new SlowMotion(controller));
  /** What a failed script download does while this view is mounted (see below); nothing once it's gone. */
  const unavailable = useRef<(source: SlowSource) => void>(() => {});
  // The script builder needs the screen: where the path's nodes are and how long its edges are.
  useLayoutEffect(() => {
    session.configure({
      unavailable: (source) => unavailable.current(source),
      build: (trace, waiting) => {
        const diagram = controller.currentDiagram;
        const nodes = buildJourney(trace, diagram).nodes;
        const still = live.current.reducedMotion;
        plan.current = planCamera(boxes(nodes), boxes([trace.origin]), pane(), insets(), overlays(), still);
        const zoom = plan.current?.zoom ?? store.getState().transform[2];
        const root = store.getState().domNode;
        const stencils = new Map(diagram.nodes.map((n) => [n.id, n.stencil]));
        // Only called once the script code arrived (session.ts waits for it before capturing).
        return slowScript()!.buildScript({
          trace,
          diagram,
          roleOf: (id) => stencilRole(stencils.get(id) ?? ""),
          reduced: live.current.reducedMotion,
          waiting,
          edgeLength: (id) => {
            const path = root?.querySelector<SVGPathElement>(
              `.react-flow__edge[data-id="${CSS.escape(id)}"] path.react-flow__edge-path`,
            );
            const length = path?.getTotalLength?.() ?? 0;
            return length > 0 ? length * zoom : 260;
          },
        });
      },
    });
  }, [session, controller, store, boxes, pane, insets, overlays]);
  // The script code downloads once Live is idle, so the first start rarely waits; a start before then waits for it.
  useEffect(() => whenIdle(() => void loadSlowScript().catch(() => {})), []);
  useEffect(() => {
    const unwatch = session.watch();
    return () => {
      unwatch();
      session.dispose();
    };
  }, [session]);
  // Leaving live mid-replay: React Flow's root stays (the canvas doesn't), so take the marks off it.
  useEffect(
    () => () => {
      const root = store.getState().domNode;
      root?.removeAttribute("data-live-slowmo");
      for (const el of root?.querySelectorAll("[data-slowmo-off]") ?? []) el.removeAttribute("data-slowmo-off");
    },
    [store],
  );
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const start = useCallback(
    (source: SlowSource) => {
      // Rebuild before saving the camera; a surviving asynchronous capture keeps this checkpoint too.
      controller.flush();
      if (session.getState().status === "off" || session.getState().status === "armed") {
        const [x, y, zoom] = store.getState().transform;
        before.current ??= { x, y, zoom };
      }
      // A right-clicked node stays selected otherwise, and Esc would clear that before leaving.
      store.getState().unselectNodesAndEdges();
      session.start(source);
    },
    [controller, session, store],
  );
  // A failed script download: the session is back to live; this view offers Retry and owns it. Retry starts through
  // `start` (camera, selection), and leaving live dismisses the toast and disarms it.
  const startRef = useRef(start);
  useLayoutEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    let alive = true;
    let toastId: number | undefined;
    let waiting: number | undefined;
    const modalOpen = () => !!document.querySelector('[aria-modal="true"]');
    const retry = (source: SlowSource) => {
      if (!alive) return;
      // A dialog opened meanwhile keeps the keyboard and the screen: slow motion starts once it closes.
      if (modalOpen()) {
        waiting = requestAnimationFrame(() => retry(source));
        return;
      }
      startRef.current(source);
    };
    unavailable.current = (source) => {
      if (!alive) return;
      const active = document.activeElement;
      // Retry takes the keyboard only from the live view that asked for slow motion, never from a dialog since.
      const owns =
        !modalOpen() && (!active || active === document.body || !!active.closest('[data-testid="canvas-wrap"]'));
      toastId = notify(LOAD_FAILED, {
        kind: "error",
        action: { label: "Retry", run: () => retry(source), testId: "lazy-load-retry", focus: owns },
      });
    };
    return () => {
      alive = false;
      unavailable.current = () => {};
      if (waiting !== undefined) cancelAnimationFrame(waiting);
      if (toastId !== undefined) toast.dismiss(toastId);
    };
  }, []);
  const end = useCallback(() => {
    const was = session.getState().status;
    session.end();
    const view = before.current;
    before.current = null;
    // Back to the view (and its owner) from before; a replay that never started has nothing to restore.
    camera.dispatch({ type: "slowmo", on: false, restore: view && was === "on" ? view : null });
  }, [session, camera]);

  // The engine was rebuilt (restart, a structural edit): slow motion's journey no longer applies.
  useEffect(() => {
    let generation = controller.getState().generation;
    return controller.subscribe(() => {
      const g = controller.getState().generation;
      if (g === generation) return;
      generation = g;
      if (session.drop()) before.current = null;
    });
  }, [controller, session]);

  // The camera. Slow motion owns the view while it records or replays (panePolicy W1): Live's own refits and
  // narration leave it alone, and ending it gives the view back (W2). Each take, and each change of its room
  // (presenting, a panel, a recording), plans the camera once the pane settles (W3, W4): a fit of the whole path,
  // then stay put, or following from the first node at a readable zoom. A pane change asks again (W5).
  const on = state.status === "on";
  const active = on || state.status === "capturing";
  const take = state.take;
  useEffect(() => {
    camera.dispatch({ type: "slowmo", on: active });
  }, [camera, active]);
  // Live view ending mid-replay (L while presenting, say) gives the view back too: its geometry goes with it.
  useEffect(() => () => camera.dispatch({ type: "slowmo", on: false }), [camera]);
  useEffect(() => {
    if (on) camera.dispatch({ type: "slowmo.take" });
  }, [camera, on, take, presenting, panelOpen, capturing]);
  useEffect(() => {
    const planFor = (trace: NonNullable<SlowState["trace"]>) => {
      const nodes = buildJourney(trace, controller.currentDiagram).nodes;
      const still = live.current.reducedMotion;
      plan.current = planCamera(boxes(nodes), boxes([trace.origin]), pane(), insets(), overlays(), still);
      return plan.current?.view ?? null;
    };
    return camera.slowmo({
      plan() {
        const s = session.getState();
        return s.script && s.trace ? planFor(s.trace) : null;
      },
      // A playing, fitted take is replanned for the new pane without rebuilding its script or seeking. A paused
      // replay and a camera moved by hand keep their exact view (a follow pan easing from before Pause stops).
      pane(following) {
        const s = session.getState();
        if (s.status !== "on") return null;
        pausedPaneAt.current = s.playing ? null : s.t;
        if (!s.playing) return "hold";
        if (!s.trace || !following || plan.current?.mode !== "fit") return null;
        return planFor(s.trace);
      },
    });
  }, [camera, session, controller, boxes, pane, insets, overlays]);

  // Keys: Space plays / pauses, ← → step hop by hop, Esc goes back to live. Menus, dialogs, panels,
  // text fields and a recording keep theirs; a selection is cleared before Esc leaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const status = session.getState().status;
      if (status === "off" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      // Text fields keep their keys; a slider (the replay's timeline) doesn't, so Esc still leaves.
      const slider = t instanceof HTMLInputElement && t.type === "range";
      if ((isEditableTarget(t) && !(slider && e.key === "Escape")) || document.querySelector(KEY_OWNERS)) return;
      if (e.key === "Escape") {
        if (isRecordingActive() || document.querySelector(SELECTED)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        end();
        return;
      }
      if (status !== "on") return;
      const inControl = t instanceof Element && !!t.closest('select, input, a, [role="separator"]');
      if (
        (e.key === " " || e.code === "Space") &&
        !(t instanceof Element && t.closest('button, select, a, [role="separator"]'))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) session.toggle();
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !inControl) {
        e.preventDefault();
        e.stopImmediatePropagation();
        session.step(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [session, end]);

  const frame = useCallback(
    (wallMs: number, speed: number): SlowPainter | undefined => {
      if (!session.on) {
        painter.show(null);
        return undefined;
      }
      session.advance(wallMs, speed);
      const f = session.frame();
      painter.show(f, live.current.presenting ? 1.3 : 1);
      // Following: pan between hops only, never while a dot travels, one move at a time (the take's fit or the
      // last pan lands first). A pan by hand gave the view up until the next take.
      const p = plan.current;
      const s = session.getState();
      if (
        f &&
        p?.mode === "follow" &&
        camera.state.owner === "slowmo" &&
        !f.travelling &&
        s.script &&
        (s.playing || pausedPaneAt.current !== s.t)
      ) {
        if (!camera.moving) {
          const next = new Set(f.frontier);
          // What must never be under the trace card: the node at work now and the next targets.
          const focus = new Set<string>();
          const edges = new Map(controller.currentDiagram.edges.map((e) => [e.id, e]));
          for (const b of s.script.beats) {
            if (b.node && b.start <= s.t && s.t < b.start + b.duration) focus.add(b.node);
            // Look a hop ahead, so the next target is in view before the dot leaves.
            if (b.edge && b.kind !== "reply" && b.start > s.t && b.start <= s.t + 1200) {
              const e = edges.get(b.edge);
              if (e) {
                next.add(b.reverse ? e.from : e.to);
                focus.add(b.reverse ? e.from : e.to);
              }
            }
          }
          const [x, y, zoom] = store.getState().transform;
          const pan = followPan(boxes(next), { x, y, zoom }, pane(), insets(), overlays(), undefined, boxes(focus));
          if (pan) camera.dispatch({ type: "slowmo.follow", view: pan });
        }
      }
      return painter;
    },
    [session, painter, controller, store, boxes, pane, insets, overlays, camera],
  );

  const ui = useCallback(
    (canvas: HTMLCanvasElement, snap: SimSnapshot, labels: readonly PaintedLabel[]) => {
      // Test hooks: the frozen clock and a checksum of the background dots, and slow motion's state.
      canvas.dataset.simTime = String(snap.time);
      let sum = 0;
      for (const p of snap.particles) sum = (sum + p.id * 7 + Math.round(p.progress * 1000)) % 1_000_000_007;
      canvas.dataset.particleSum = String(sum);
      const root = store.getState().domNode;
      const s = session.getState();
      if (s.status === "on") {
        if (s.playing) session.publish();
        const f = session.frame();
        canvas.dataset.slowmo = s.playing ? "playing" : "paused";
        canvas.dataset.slowmoCamera = plan.current?.mode ?? "";
        canvas.dataset.slowmoProgress = String(
          s.script ? Math.round((s.t / Math.max(1, s.script.duration)) * 1000) : 0,
        );
        canvas.dataset.slowmoBeat = String(f?.beat ?? -1);
        canvas.dataset.slowmoDots = String(f?.moving ?? 0);
        canvas.dataset.slowmoCaptions = JSON.stringify(labels);
        root?.setAttribute("data-live-slowmo", "on");
        // Badges off the path step back with their nodes.
        const path = new Set(s.script?.nodes ?? []);
        for (const el of root?.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"]') ?? []) {
          const off = !path.has(el.dataset.testid!.slice("node-badge-".length));
          if (off !== el.hasAttribute("data-slowmo-off")) el.toggleAttribute("data-slowmo-off", off);
        }
      } else if (canvas.dataset.slowmo) {
        for (const a of [
          "data-slowmo",
          "data-slowmo-camera",
          "data-slowmo-progress",
          "data-slowmo-beat",
          "data-slowmo-dots",
          "data-slowmo-captions",
        ])
          canvas.removeAttribute(a);
        root?.removeAttribute("data-live-slowmo");
        for (const el of root?.querySelectorAll("[data-slowmo-off]") ?? []) el.removeAttribute("data-slowmo-off");
        painter.reset();
      }
    },
    [session, painter, store],
  );

  const script = state.script;
  const [path, setPath] = useState<SlowMotionView["path"]>(null);
  const [pathFor, setPathFor] = useState<typeof script>(null);
  if (pathFor !== script) {
    setPathFor(script);
    setPath(script ? { nodes: new Set(script.nodes), edges: new Set(script.edges) } : null);
  }

  return { session, state, start, end, frame, ui, path };
}
