// Wires slow motion into the live view: the session (record ahead, then replay), the camera (fit the
// path once, follow only when it can't be read), the keys (Space, ← →, Esc) and the painter the
// particle renderer draws over its frozen frame. LiveView calls `frame()` from its animation loop.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { useStoreApi } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { isEditableTarget } from "../../editor/shortcuts";
import type { SimSnapshot } from "../../sim/types";
import { stencilRole } from "../../stencils/roles";
import { buildJourney } from "../../trace/journey";
import type { LiveController } from "../controller";
import { LIVE_BAR_SPACE } from "../layout";
import { TRACE_CARD_FOOTPRINT, TRACE_CARD_TOP } from "../traceCardLayout";
import type { RenderOverlay } from "../particleRenderer";
import { isRecordingActive } from "../record/framing";
import { FIT_MS, PAN_MS, followPan, planCamera, type CameraPlan, type FlowBox, type Insets, type View } from "./camera";
import { SlowPainter } from "./painter";
import { buildScript } from "./script";
import { SlowMotion, type SlowSource, type SlowState } from "./session";

type Store = ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
type SetViewport = (v: View, opts?: { duration?: number }) => unknown;

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
  /** Called every animation frame: advances the replay and returns what to draw over live. */
  frame(wallMs: number, speed: number): RenderOverlay | undefined;
  /** Called at the UI clock (~8 Hz): state for React, test hooks on the canvas. */
  ui(canvas: HTMLCanvasElement, snap: SimSnapshot): void;
  /** The nodes and edges the replay visits (they stay lit; the rest dims). */
  path: { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null;
}

export function useSlowMotion(opts: {
  controller: LiveController;
  store: Store;
  setViewport: SetViewport;
  presenting: boolean;
  reducedMotion: boolean;
  /** A side panel covers the right of the pane. */
  panelOpen: boolean;
  /** A recording is being captured: the trace card is hidden, so the fit can use its room. */
  capturing: boolean;
}): SlowMotionView {
  const { controller, store, setViewport, presenting, reducedMotion, panelOpen, capturing } = opts;
  const live = useRef({ reducedMotion, panelOpen, capturing, presenting });
  useLayoutEffect(() => {
    live.current = { reducedMotion, panelOpen, capturing, presenting };
  }, [reducedMotion, panelOpen, capturing, presenting]);
  const plan = useRef<CameraPlan | null>(null);
  const following = useRef(true);
  const panUntil = useRef(0);
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
  // The script builder needs the screen: where the path's nodes are and how long its edges are.
  useLayoutEffect(() => {
    session.configure({
      build: (trace, waiting) => {
        const diagram = controller.currentDiagram;
        const nodes = buildJourney(trace, diagram).nodes;
        plan.current = planCamera(boxes(nodes), boxes([trace.origin]), pane(), insets(), overlays());
        const zoom = plan.current?.zoom ?? store.getState().transform[2];
        const root = store.getState().domNode;
        const stencils = new Map(diagram.nodes.map((n) => [n.id, n.stencil]));
        return buildScript({
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
  useEffect(() => {
    const unwatch = session.watch();
    return () => {
      unwatch();
      session.dispose();
    };
  }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const start = useCallback(
    (source: SlowSource) => {
      if (session.getState().status === "off" || session.getState().status === "armed") {
        const [x, y, zoom] = store.getState().transform;
        before.current ??= { x, y, zoom };
      }
      // A right-clicked node stays selected otherwise, and Esc would clear that before leaving.
      store.getState().unselectNodesAndEdges();
      session.start(source);
    },
    [session, store],
  );
  const end = useCallback(() => {
    const was = session.getState().status;
    session.end();
    const view = before.current;
    before.current = null;
    if (view && was === "on") void setViewport(view, { duration: live.current.reducedMotion ? 0 : FIT_MS });
  }, [session, setViewport]);

  // The engine was rebuilt (restart, a structural edit): slow motion's journey no longer applies.
  useEffect(() => {
    let generation = controller.getState().generation;
    return controller.subscribe(() => {
      const g = controller.getState().generation;
      if (g === generation) return;
      generation = g;
      session.drop();
      before.current = null;
    });
  }, [controller, session]);

  // The camera: fit the whole path once per take (and after presentation, a panel or a recording
  // changes the room), then stay put. Following starts on the first node at a readable zoom.
  const on = state.status === "on";
  const take = state.take;
  useEffect(() => {
    if (!on) return;
    following.current = true;
    const t = window.setTimeout(() => {
      const s = session.getState();
      if (!s.script) return;
      const nodes = buildJourney(s.trace!, controller.currentDiagram).nodes;
      plan.current = planCamera(boxes(nodes), boxes([s.trace!.origin]), pane(), insets(), overlays());
      if (plan.current) void setViewport(plan.current.view, { duration: live.current.reducedMotion ? 0 : FIT_MS });
      panUntil.current = performance.now() + FIT_MS;
    }, 180);
    return () => window.clearTimeout(t);
  }, [on, take, presenting, panelOpen, capturing, session, controller, boxes, pane, insets, overlays, setViewport]);

  // Panning or zooming by hand stops following until Replay.
  useEffect(() => {
    const root = store.getState().domNode;
    if (!on || !root) return;
    const pane = root.querySelector(".react-flow__pane") ?? root;
    const stop = () => (following.current = false);
    pane.addEventListener("pointerdown", stop);
    root.addEventListener("wheel", stop, { passive: true });
    return () => {
      pane.removeEventListener("pointerdown", stop);
      root.removeEventListener("wheel", stop);
    };
  }, [on, store]);

  // Keys: Space plays / pauses, ← → step hop by hop, Esc goes back to live. Menus, dialogs, panels,
  // text fields and a recording keep theirs; a selection is cleared before Esc leaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const status = session.getState().status;
      if (status === "off" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (isEditableTarget(t) || document.querySelector(KEY_OWNERS)) return;
      if (e.key === "Escape") {
        if (isRecordingActive() || document.querySelector(SELECTED)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        end();
        return;
      }
      if (status !== "on") return;
      const inControl = t instanceof Element && !!t.closest("select, input, a");
      if ((e.key === " " || e.code === "Space") && !(t instanceof Element && t.closest("button, select, a"))) {
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
    (wallMs: number, speed: number): RenderOverlay | undefined => {
      if (!session.on) {
        painter.show(null);
        return undefined;
      }
      session.advance(wallMs, speed);
      const f = session.frame();
      painter.show(f, live.current.presenting ? 1.3 : 1);
      // Following: pan between hops only, never while a dot travels.
      const p = plan.current;
      const s = session.getState();
      if (f && p?.mode === "follow" && following.current && !f.travelling && s.script) {
        const now = performance.now();
        if (now >= panUntil.current) {
          const next = new Set(f.frontier);
          const edges = new Map(controller.currentDiagram.edges.map((e) => [e.id, e]));
          // Look a hop ahead, so the next target is in view before the dot leaves.
          for (const b of s.script.beats)
            if (b.edge && b.kind !== "reply" && b.start > s.t && b.start <= s.t + 1200) {
              const e = edges.get(b.edge);
              if (e) next.add(b.reverse ? e.from : e.to);
            }
          const [x, y, zoom] = store.getState().transform;
          const pan = followPan(boxes(next), { x, y, zoom }, pane(), insets(), overlays());
          if (pan) {
            const reduced = live.current.reducedMotion;
            void setViewport(pan, { duration: reduced ? 0 : PAN_MS });
            panUntil.current = now + (reduced ? 0 : PAN_MS);
          }
        }
      }
      return painter;
    },
    [session, painter, controller, store, boxes, pane, insets, overlays, setViewport],
  );

  const ui = useCallback(
    (canvas: HTMLCanvasElement, snap: SimSnapshot) => {
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
        canvas.dataset.slowmoBeat = String(f?.beat ?? -1);
        canvas.dataset.slowmoDots = String(f?.moving ?? 0);
        canvas.dataset.slowmoCaptions = JSON.stringify(painter.labels);
        root?.setAttribute("data-live-slowmo", "on");
        // Badges off the path step back with their nodes.
        const path = new Set(s.script?.nodes ?? []);
        for (const el of root?.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"]') ?? []) {
          const off = !path.has(el.dataset.testid!.slice("node-badge-".length));
          if (off !== el.hasAttribute("data-slowmo-off")) el.toggleAttribute("data-slowmo-off", off);
        }
      } else if (canvas.dataset.slowmo) {
        for (const a of ["data-slowmo", "data-slowmo-beat", "data-slowmo-dots", "data-slowmo-captions"])
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
