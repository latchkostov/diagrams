import { edgeSemanticSignature } from "../model/relations";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ViewportPortal,
  useReactFlow,
  useStore,
  useStoreApi,
  type FitViewOptions,
  type ReactFlowState,
} from "@xyflow/react";
import type { DiagramFile, Simulation } from "../model/types";
import type { MessageTrace, NodeStatus } from "../sim/types";
import type { EditorApi } from "../editor/types";
import { actionRegistry, builtinSections } from "../editor/actions";
import { isEditableTarget } from "../editor/shortcuts";
import { inCanvas } from "../editor/useCanvasShortcuts";
import { useSettings } from "../harness/settings";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { useAllRoutes, useRoutingOptions } from "../canvas/edges/useEdgeRoute";
import { LiveController } from "./controller";
import { LiveContext, useLiveState, type LiveUi, type TraceChoice } from "./context";
import { Decorator } from "./decorations";
import { downstreamOfEdge, edgesWithin } from "./graph";
import { liveActions, liveMutationGuard } from "./liveActions";
import { DEFAULT_TOKENS, readParticleTokens, type Rect } from "./particleRenderer";
import { createLiveRenderer, pickRenderer, type LiveRenderer, type RendererKind } from "./liveRenderer";
import { createStormSimulation, suggestedMessageType } from "./storm";
import { writeLiveParams } from "./urlParams";
import { ControlBar } from "./ControlBar";
import { NodeBadges } from "./NodeBadges";
import { NoteCallout } from "./NoteCallout";
import { EventLog } from "./EventLog";
import { InjectDialog, type InjectRequest } from "./InjectDialog";
import { SimPanel } from "./SimPanel";
import { LiveIcon } from "./icons";
import { LIVE_BAR_SPACE, LIVE_BAR_VAR } from "./layout";
import { CapacityPanel } from "./CapacityPanel";
import { BottleneckCallout, CapacityLayer } from "./CapacityLayer";
import { addConsumer } from "./addConsumer";
import { capacityOverlay, useCapacityOverlay } from "./capacityOverlay";
import { useLiveSessionHost } from "../palette/host";
import {
  capacityView,
  emptyInputs,
  freePlaySimulation,
  inputsWithoutFix,
  withFix,
  type CapacityFix,
} from "./capacityModel";
import { capacitySaveCandidate, capacitySaveError } from "./capacityPersistence";
import { notify } from "../interop/ui/toast";
import { stencilRole } from "../stencils/roles";
import { motionMs } from "../lib/motion";
import { placeNextTo } from "../canvas/placement";
import { Recorder } from "./record/Recorder";
import { initialRecordState, isCapturing, recordReducer } from "./record/recordModel";
import { isRecordingActive } from "./record/framing";
import { TraceCard } from "./TraceCard";
import { useSlowMotion, type SlowMotionView } from "./slowmo/useSlowMotion";
import { SlowCaption } from "./slowmo/SlowBar";
import type { SlowSource } from "./slowmo/session";
import { PACING } from "./slowmo/script";
import { formatDuration as formatSpan } from "../trace/journey";
import { TRACE_CARD_FOOTPRINT, TRACE_CARD_TOP, roomUnderCard } from "./traceCardLayout";
import { fitAvoiding, type Viewport } from "../canvas/geometry/fit";
// Loaded on first use: the sequence generator, its SVG renderer and Mermaid writer.
const SequenceDialog = lazy(() => import("./SequenceDialog").then((m) => ({ default: m.SequenceDialog })));
import { buildJourney } from "../trace/journey";
import { useAiDock } from "../ai/ui/dock";

import type { LiveSessionHandle, LiveViewProps } from "./LiveView";

// The live session: the simulation, its renderers and panels, slow motion and recording. It loads when live
// view first turns on (or earlier, once the canvas is idle; see LiveView), never with the first view.

const UI_MS = 125;
/** "Traffic into X": the first of these that starts traffic in the simulation (a source). */
const ENTRY_STENCILS = ["client.user", "client.browser", "generic.webhook"];
/** Things that own Esc before live view does (checked before they react, in the capture phase). */
const ESC_OWNERS = [
  '[role="menu"]',
  '[role="dialog"]',
  '[data-testid="sim-panel"]',
  '[data-testid="capacity-panel"]',
].join(",");
/** A selection is cleared before Esc backs out of a trace or live view. */
const SELECTED = ".react-flow__node.selected, .react-flow__edge.selected";
/**
 * A fit of every node that leaves the trace card's footprint (its first rows, top right) clear:
 * beside it, below it, or untouched when nothing sits there anyway (see geometry/fit.ts).
 */
function fitBesideCard(s: ReactFlowState<FlowNode, DiagramFlowEdge>): Viewport | null {
  const items: Rect[] = [];
  for (const n of s.nodeLookup.values()) {
    const width = n.measured?.width ?? 0;
    const height = n.measured?.height ?? 0;
    if (n.hidden || !width || !height) continue;
    items.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height });
  }
  const pane = s.domNode?.getBoundingClientRect();
  const el = s.domNode?.querySelector<HTMLElement>('[data-testid="trace-card"]')?.getBoundingClientRect();
  const width = el?.width || 352;
  const x = el && pane ? el.left - pane.left : s.width - 16 - width;
  const pad = FULL_FIT.padding as Record<"top" | "right" | "bottom" | "left", string>;
  const px = (v: string) => parseFloat(v);
  return fitAvoiding(
    items,
    { width: s.width, height: s.height },
    [{ x, y: TRACE_CARD_TOP, width, height: TRACE_CARD_FOOTPRINT }],
    {
      margin: 0,
      gap: 16,
      maxZoom: FULL_FIT.maxZoom,
      insets: { top: px(pad.top), right: px(pad.right), bottom: px(pad.bottom), left: px(pad.left) },
    },
  );
}

const LOOK_AHEAD_LABEL = "30 s";
const DEAD_LETTER_WAIT = "Nothing has dead-lettered yet: the next message that does will be traced.";
const NOTE_PADDING = { top: "170px", right: "80px", bottom: "230px", left: "80px" } as const;
const NOTE_FIT: FitViewOptions = { padding: NOTE_PADDING, maxZoom: 1, duration: 900 };
const FULL_FIT: FitViewOptions = {
  padding: { top: "110px", right: "48px", bottom: `${48 + LIVE_BAR_SPACE}px`, left: "48px" },
  maxZoom: 1.25,
  duration: 700,
};

/**
 * The live view: a "Live" toggle on the canvas, and while it's on, the simulation session
 * (particles, badges, controls, notes, authoring). Rendered as a child of <ReactFlow>.
 */
export interface SessionProps extends LiveViewProps {
  params: NonNullable<LiveViewProps["initial"]>;
  onExit: () => void;
  /** Reports this session to a page that drives it from outside (null when it ends). */
  onSession?: (session: LiveSessionHandle | null) => void;
}

export function LiveSession({
  editor,
  presenting,
  simulations: simsProp,
  diagram,
  params,
  onExit,
  alwaysOn,
  onSaveDiagram,
  onPanelChange,
  onSession,
  privateDiagram,
}: SessionProps) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { fitView, setViewport } = useReactFlow<FlowNode, DiagramFlowEdge>();
  const { theme } = useSettings();
  const getDiagram = useCallback((): DiagramFile => (editor ? editor.getDiagram() : diagram!), [editor, diagram]);
  const simulations = useMemo(() => simsProp ?? diagram?.simulations ?? [], [simsProp, diagram]);
  const simsRef = useRef(simulations);
  useLayoutEffect(() => {
    simsRef.current = simulations;
  }, [simulations]);

  const [draft, setDraft] = useState<Simulation | null>(null);
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const [controller] = useState(() => {
    const c = new LiveController(getDiagram());
    if (params.speed) c.setSpeed(params.speed);
    const sim = params.sim ? simulations.find((s) => s.id === params.sim) : undefined;
    if (sim) c.selectSimulation(sim);
    // Free play starts with gentle continuous traffic so something is always flowing.
    else if (params.traffic !== false) c.setTraffic(true);
    if (params.traffic === false) c.setTraffic(false);
    if (params.trace === "next") c.traceNext();
    else if (params.trace === "deadletter") c.traceDeadLettered();
    if (params.inputs) c.setInputs({ ...emptyInputs(), ...params.inputs });
    if (sim && params.seekMs) c.seek(params.seekMs);
    if (!params.paused) c.setPlaying(true);
    return c;
  });
  const state = useLiveState(controller);

  const [panel, setPanel] = useState<{ open: boolean; kind: "sims" | "capacity"; sim: Simulation | null }>(() => ({
    open: params.panel === "capacity",
    kind: params.panel === "capacity" ? "capacity" : "sims",
    sim: null,
  }));
  const capacityOpen = panel.open && panel.kind === "capacity";
  useEffect(() => () => controller.dispose(), [controller]);
  const [events, setEvents] = useState<{ open: boolean; nodeId: string | null }>({ open: false, nodeId: null });
  const [trace, setTrace] = useState<string | null>(null);
  const traceRef = useRef(trace);
  useLayoutEffect(() => {
    traceRef.current = trace;
  }, [trace]);
  const [inject, setInject] = useState<InjectRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // ---------------------------------------------------------------- diagram edits while live

  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  useEffect(() => {
    if (!editor) return;
    const t = window.setTimeout(() => {
      const result = controller.updateDiagram(getDiagram());
      if (result === "reloaded") flash("The diagram changed, so the simulation restarted.");
    }, 200);
    return () => window.clearTimeout(t);
  }, [nodes, edges, editor, controller, getDiagram, flash]);

  // A saved simulation edited elsewhere (undo, the panel's Save) replays with the new definition.
  useEffect(() => {
    const cur = controller.getState().simulation;
    if (!cur || cur.id === draftRef.current?.id) return;
    const next = simulations.find((s) => s.id === cur.id);
    if (!next) controller.selectSimulation(null);
    // Keep the Inputs & capacity what-ifs; prop changes (Apply fix, undo) patch the run live.
    else if (JSON.stringify(next) !== JSON.stringify(cur)) controller.setBase(next);
  }, [simulations, controller]);

  // Mirror the live state into the URL (canvas only) so the address is a shareable live link. A private diagram
  // can't be shared as one, and its simulation ids can carry its words: only `live=1` goes in its address.
  const simId = state.simulation && state.simulation.id !== draft?.id ? state.simulation.id : null;
  useEffect(() => {
    if (editor) writeLiveParams(true, privateDiagram ? null : simId);
  }, [editor, simId, privateDiagram]);

  // ---------------------------------------------------------------- spotlight (notes, trace)

  const note = state.run?.note;
  const noteKey = note ? `${state.generation}:${note.atMs}:${note.text}` : "";
  // The controller publishes fresh note objects each tick; keep the focus stable for camera effects.
  const focusKey = JSON.stringify(note?.focus ?? []);
  const noteFocus = useMemo(() => JSON.parse(focusKey) as string[], [focusKey]);
  // A traced message lights the path it has taken so far (or the node it's awaited at).
  const tracedNow = state.trace?.current;
  const awaitedAt = state.trace?.pending?.next === "message" ? state.trace.pending.node : undefined;
  const tracedDiagram = controller.currentDiagram;
  const tracedPath = useMemo(() => {
    if (tracedNow) {
      const j = buildJourney(tracedNow, tracedDiagram);
      return { nodes: new Set(j.nodes), edges: new Set(j.edges) };
    }
    return awaitedAt ? { nodes: new Set([awaitedAt]), edges: new Set<string>() } : null;
  }, [tracedNow, awaitedAt, tracedDiagram]);
  // Slow motion owns the camera and the spotlight while it's on (see useSlowMotion).
  const slowRef = useRef<SlowMotionView | null>(null);
  const [slowPath, setSlowPath] = useState<SlowMotionView["path"]>(null);
  const spotlight = (() => {
    const d = controller.currentDiagram;
    if (slowPath) return { ...slowPath, kind: "trace" as const };
    if (tracedPath) return { ...tracedPath, kind: "trace" as const };
    if (trace) {
      const r = downstreamOfEdge(d.edges, trace);
      return { nodes: r.nodes, edges: r.edges, kind: "trace" as const };
    }
    if (noteFocus.length) {
      const focus = new Set(noteFocus);
      return { nodes: focus, edges: edgesWithin(d.edges, focus), kind: "focus" as const };
    }
    return null;
  })();
  const spotlightRef = useRef(spotlight);
  useLayoutEffect(() => {
    spotlightRef.current = spotlight;
  }, [spotlight]);

  const panelOpenRef = useRef(false);
  useLayoutEffect(() => {
    panelOpenRef.current = panel.open;
  }, [panel.open]);
  // The trace card sits at the top right. A note's close-up leaves the card its column; the whole
  // diagram only keeps clear of the card's first rows (see fitAll), and the card grows down to it.
  const cardOpen = !!state.trace;
  const cardOpenRef = useRef(false);
  useLayoutEffect(() => {
    cardOpenRef.current = cardOpen;
  }, [cardOpen]);
  const fitPadding = useCallback((base: typeof NOTE_PADDING, panelOpen = panelOpenRef.current) => {
    if (panelOpen) return { ...base, right: "440px" as const };
    return cardOpenRef.current ? { ...base, right: "400px" as const } : base;
  }, []);
  const FULL_PADDING = FULL_FIT.padding as typeof NOTE_PADDING;
  /**
   * The whole diagram in view. With the trace card open (and no side panel) it keeps clear of the
   * card's footprint only: a wide diagram moves down a little instead of shrinking to the left of a
   * full-height column, so tracing costs no zoom.
   */
  const fitAll = useCallback(
    (duration: number, panelOpen = panelOpenRef.current) => {
      if (cardOpenRef.current && !panelOpen) {
        const v = fitBesideCard(store.getState());
        if (v) {
          void setViewport(v, { duration });
          return;
        }
      }
      void fitView({ ...FULL_FIT, padding: fitPadding(FULL_PADDING, panelOpen), duration });
    },
    [store, setViewport, fitView, fitPadding, FULL_PADDING],
  );

  // Pan / zoom to a note's focus, and back out to the whole diagram when the story moves on.
  const zoomedForNote = useRef(false);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const focus = noteFocus;
    // Wait out the canvas's own refit (presentation mode toggles refit after ~80 ms).
    const t = window.setTimeout(
      () => {
        if (focus.length) {
          zoomedForNote.current = true;
          const padding = fitPadding(NOTE_PADDING);
          void fitView({
            ...NOTE_FIT,
            padding,
            nodes: focus.map((id) => ({ id })),
            duration: reducedMotion ? 0 : NOTE_FIT.duration,
          });
        } else if (zoomedForNote.current) {
          zoomedForNote.current = false;
          fitAll(reducedMotion ? 0 : (FULL_FIT.duration ?? 0));
        }
      },
      panelOpenRef.current ? 320 : 160,
    );
    return () => window.clearTimeout(t);
  }, [noteKey, noteFocus, fitView, reducedMotion, fitPadding, fitAll]);

  // The authoring panel covers the right of the pane: fit the diagram into what's left (unless a
  // note is steering the camera).
  // A panel opened during a note refits to the note's focus, so the focused nodes never sit under it.
  const noteFocusRef = useRef(noteFocus);
  useLayoutEffect(() => {
    noteFocusRef.current = noteFocus;
  }, [noteFocus]);
  const panelFitted = useRef(false);
  useEffect(() => {
    if (panel.open === panelFitted.current) return;
    panelFitted.current = panel.open;
    const t = window.setTimeout(() => {
      const duration = reducedMotion ? 0 : FULL_FIT.duration;
      if (zoomedForNote.current) {
        const focus = noteFocusRef.current;
        if (!focus.length) return;
        const padding = fitPadding(NOTE_PADDING, panel.open);
        void fitView({ ...NOTE_FIT, padding, nodes: focus.map((id) => ({ id })), duration });
        return;
      }
      fitAll(duration ?? 0, panel.open);
    }, 320);
    return () => window.clearTimeout(t);
  }, [panel.open, fitView, reducedMotion, fitPadding, fitAll]);

  // Opening or closing the trace card refits, so it never covers the diagram.
  const cardFitted = useRef(false);
  useEffect(() => {
    if (cardOpen === cardFitted.current || panelOpenRef.current) return;
    cardFitted.current = cardOpen;
    if (slowRef.current?.session.active) return;
    const t = window.setTimeout(() => {
      const duration = reducedMotion ? 0 : FULL_FIT.duration;
      const focus = noteFocusRef.current;
      if (zoomedForNote.current && focus.length)
        void fitView({ ...NOTE_FIT, padding: fitPadding(NOTE_PADDING), nodes: focus.map((id) => ({ id })), duration });
      else fitAll(duration ?? 0);
    }, 120);
    return () => window.clearTimeout(t);
  }, [cardOpen, fitView, reducedMotion, fitPadding, fitAll]);

  // The AI panel opened, closed or was resized: the pane changed width at its right edge. Refit the
  // same way, or half the diagram stayed past the pane's edge (slow motion keeps its own camera).
  const dock = useAiDock();
  const dockKey = `${dock.open}:${dock.open ? Math.round(dock.width / 40) : 0}`;
  const dockFitted = useRef(dockKey);
  useEffect(() => {
    if (dockKey === dockFitted.current) return;
    dockFitted.current = dockKey;
    if (presenting) return;
    // After React Flow's ResizeObserver has the new pane size.
    const t = window.setTimeout(() => {
      if (slowRef.current?.session.active) return;
      const duration = reducedMotion ? 0 : FULL_FIT.duration;
      const focus = noteFocusRef.current;
      if (zoomedForNote.current && focus.length)
        void fitView({ ...NOTE_FIT, padding: fitPadding(NOTE_PADDING), nodes: focus.map((id) => ({ id })), duration });
      else fitAll(duration ?? 0);
    }, 200);
    return () => window.clearTimeout(t);
  }, [dockKey, presenting, fitView, reducedMotion, fitPadding, fitAll]);

  // ---------------------------------------------------------------- the frame loop

  // A callback ref: ViewportPortal renders nothing until React Flow's DOM exists.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // Edge label pills sit above the particles; dots behind one are drawn dimmed on this overlay.
  const [overlay, setOverlay] = useState<HTMLCanvasElement | null>(null);
  // The pills' rects, from the router's placements (the same routes the edges draw; re-read only
  // when the routes change, never per frame).
  const routes = useAllRoutes(useRoutingOptions());
  const labelRects = useMemo(() => {
    const out: Rect[] = [];
    for (const r of routes.values())
      if (r.label)
        out.push({
          x: r.label.x - r.label.width / 2,
          y: r.label.y - r.label.height / 2,
          width: r.label.width,
          height: r.label.height,
        });
    return out;
  }, [routes]);
  const labelRectsRef = useRef(labelRects);
  useLayoutEffect(() => {
    labelRectsRef.current = labelRects;
  }, [labelRects]);
  // Token values change with the theme attribute, which the settings provider sets in an effect.
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTokens(readParticleTokens()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  const renderOpts = useMemo(
    () => ({ theme, reducedMotion, scale: presenting ? 1.35 : 1, tokens }),
    [theme, reducedMotion, presenting, tokens],
  );
  // Particles draw in a worker on an OffscreenCanvas where the browser can (liveRenderer.ts); if the
  // worker fails, fresh canvases (a new key) take the main-thread fallback.
  const [rendererKind, setRendererKind] = useState<RendererKind>(() => pickRenderer());
  const rendererRef = useRef<LiveRenderer | null>(null);
  const renderOptsRef = useRef(renderOpts);
  useLayoutEffect(() => {
    renderOptsRef.current = renderOpts;
    rendererRef.current?.setOptions(renderOpts);
  }, [renderOpts]);

  useEffect(() => {
    const root = store.getState().domNode;
    // After a fallback the old canvases (handed to the worker, now unmounted) linger in state for one
    // render: wait for the fresh ones.
    if (!canvas || !overlay || !root || !canvas.isConnected || !overlay.isConnected) return;
    // Fit-view padding elsewhere can reserve room for the control bar.
    root.style.setProperty(LIVE_BAR_VAR, `${LIVE_BAR_SPACE}px`);
    const renderer = createLiveRenderer(rendererKind, {
      canvas,
      overlay,
      root,
      store,
      labelRects: () => labelRectsRef.current,
      options: renderOptsRef.current,
      onFail: (reason) => {
        console.warn(`Live particles: ${reason}; drawing on the main thread instead.`);
        setRendererKind("main");
      },
    });
    rendererRef.current = renderer;
    // Test hook (dev and e2e builds): read a layer's pixels, wherever it is drawn.
    const testHooks = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
    if (testHooks)
      (window as unknown as { __liveProbe?: LiveRenderer["probe"] }).__liveProbe = (l, r) => renderer.probe(l, r);
    const decorator = new Decorator(root);
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let generation = controller.getState().generation;
    let stats = 0;
    let lastTime = NaN;
    let lastGeneration = generation;
    /** Milliseconds of moving simulation: the marching ants' clock (it stops when the simulation does). */
    let march = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      controller.advance(dt);
      const gen = controller.getState().generation;
      if (gen !== generation) {
        generation = gen;
        renderer.reset();
      }
      const snap = controller.snapshot();
      const speed = controller.getState().speed;
      // Slow motion: live is frozen underneath, and the replay is drawn over it.
      const slow = slowRef.current?.frame(dt, speed);
      // The simulation stands still (paused, a note waiting, slow motion): so do the marching edges.
      // Read off the sim clock: a waiting note hands out fresh snapshots at the same time. Slow motion
      // shows them unshifted, like the SVG's `animation: none` did.
      const still = snap.time === lastTime && gen === lastGeneration;
      lastTime = snap.time;
      lastGeneration = gen;
      march = slow ? 0 : still ? march : march + dt;
      const ui = now - lastUi >= UI_MS;
      if (ui) {
        lastUi = now;
        if (controller.isPlaying) controller.publish();
        // Before the frame, so an edge marked active marches in the same frame its SVG stops.
        decorator.apply({ snapshot: snap, spotlight: spotlightRef.current, still });
        renderer.tick();
      }
      renderer.frame({ snap, now, speed, focus: slow ? undefined : controller.tracedRoot, slow, march });
      if (ui) {
        slowRef.current?.ui(canvas, snap, renderer.slowLabels);
        if (++stats % 2 === 0) {
          canvas.dataset.particles = String(renderer.drawn);
          canvas.dataset.frames = String(renderer.frames);
        }
        // The traced message's labels, for tests (pane CSS px).
        if (renderer.labels.length)
          canvas.dataset.traceLabels = JSON.stringify(
            renderer.labels.map((l) => ({ text: l.text, x: l.x, y: l.y, w: l.w, h: l.h })),
          );
        else delete canvas.dataset.traceLabels;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      decorator.clear();
      root.style.removeProperty(LIVE_BAR_VAR);
      renderer.dispose();
      rendererRef.current = null;
      if (testHooks) delete (window as unknown as { __liveProbe?: unknown }).__liveProbe;
    };
    // renderOpts changes are applied through setOptions above, without restarting the loop.
  }, [controller, store, canvas, overlay, rendererKind]);

  // Click a particle to trace its message; the pointer says when one is under it.
  useEffect(() => {
    const root = store.getState().domNode;
    if (!canvas || !root) return;
    let down: { x: number; y: number } | null = null;
    const hit = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".react-flow__node, [data-editor-overlay], button, input, select")) return undefined;
      const r = root.getBoundingClientRect();
      return rendererRef.current?.hitTest(e.clientX - r.left, e.clientY - r.top);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      if (slowRef.current?.session.active) return;
      const id = hit(e);
      if (id === undefined) return;
      e.stopPropagation();
      e.preventDefault();
      controller.traceMessage(id);
    };
    const onMove = (e: PointerEvent) => {
      const over = !e.buttons && hit(e) !== undefined;
      if (over) root.setAttribute("data-live-particle", "hover");
      else root.removeAttribute("data-live-particle");
    };
    root.addEventListener("pointerdown", onDown, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("pointermove", onMove);
    return () => {
      root.removeEventListener("pointerdown", onDown, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("pointermove", onMove);
      root.removeAttribute("data-live-particle");
    };
  }, [controller, store, canvas]);

  const [sequence, setSequence] = useState<MessageTrace | null>(null);
  // One way in for the ⋯ menu, the right-click and the palette (same words when there's nothing yet).
  const startTrace = useCallback(
    (which: TraceChoice) => {
      if (which === "slowmo") return slowRef.current?.start({ kind: "next" });
      // A new trace leaves slow motion first (live comes back where it was).
      slowRef.current?.end();
      if (which === "next") controller.traceNext();
      else if (which === "slowest") {
        if (!controller.traceSlowest()) flash("No message has finished its journey yet. Try again in a moment.");
      } else if (controller.traceDeadLettered() === "waiting") flash(DEAD_LETTER_WAIT);
    },
    [controller, flash],
  );
  // The card grows down to the first node under it (its hops scroll), never over the diagram. Heading
  // a side panel's column, its height is the panel's business (trace.css).
  const cardRoom = useStore((s) => (state.trace && !panel.open ? roomUnderCard(s, presenting ? 392 : 352) : 0));
  // "Nothing has dead-lettered yet" is out of date once one has: the trace card takes over.
  const shownNotice = notice === DEAD_LETTER_WAIT && state.trace?.current ? null : notice;
  const sendOne = useCallback(
    (nodeId: string) => controller.sendOne(nodeId, suggestedMessageType(getDiagram(), nodeId)),
    [controller, getDiagram],
  );

  // ---------------------------------------------------------------- commands

  const [capacityError, setCapacityError] = useState<string | null>(null);
  const clearCapacityError = useCallback(() => setCapacityError(null), []);

  const selectSimulation = useCallback(
    (id: string | null) => {
      if (slowRef.current?.session.active) return;
      const sim = id
        ? draftRef.current?.id === id
          ? draftRef.current
          : simsRef.current.find((s) => s.id === id)
        : null;
      setTrace(null);
      setCapacityError(null);
      controller.selectSimulation(sim ?? null);
      if (sim) controller.setTraffic(false);
      controller.setPlaying(true);
    },
    [controller],
  );

  /**
   * A saved simulation (or the draft) opened for editing becomes the one that runs, so the live
   * bar's picker and the canvas show what's being edited instead of free play. Play / pause stays.
   */
  const showSimulation = useCallback(
    (sim: Simulation) => {
      if (controller.getState().simulation?.id === sim.id) return;
      const known =
        simsRef.current.find((s) => s.id === sim.id) ?? (draftRef.current?.id === sim.id ? draftRef.current : null);
      if (!known) return;
      setTrace(null);
      setCapacityError(null);
      controller.selectSimulation(known);
      controller.setTraffic(false);
    },
    [controller],
  );

  const runDraft = useCallback(
    (sim: Simulation) => {
      const saved = simsRef.current.some((s) => s.id === sim.id && JSON.stringify(s) === JSON.stringify(sim));
      setDraft(saved ? null : sim);
      draftRef.current = saved ? null : sim;
      setTrace(null);
      controller.setTraffic(false);
      setCapacityError(null);
      controller.selectSimulation(sim);
      controller.setPlaying(true);
    },
    [controller],
  );

  const saveSimulation = useCallback(
    (sim: Simulation) => {
      if (!editor) return;
      const list = [...(editor.getDiagram().simulations ?? [])];
      const i = list.findIndex((s) => s.id === sim.id);
      if (i >= 0) list[i] = sim;
      else list.push(sim);
      const error = capacitySaveError({ ...editor.getDiagram(), simulations: list });
      if (error) {
        setCapacityError(error);
        notify(error, { kind: "error" });
        return false;
      }
      setCapacityError(null);
      editor.updateMeta({ simulations: list });
      onSaveDiagram?.({ ...editor.getDiagram(), simulations: list });
      if (draftRef.current?.id === sim.id) {
        setDraft(null);
        draftRef.current = null;
      }
      flash(`Saved “${sim.title}” to this diagram.`);
      return true;
    },
    [editor, flash, onSaveDiagram],
  );

  const deleteSimulation = useCallback(
    (id: string) => {
      if (!editor) return;
      editor.updateMeta({ simulations: (editor.getDiagram().simulations ?? []).filter((s) => s.id !== id) });
      if (draftRef.current?.id === id) setDraft(null);
      if (controller.getState().simulation?.id === id) controller.selectSimulation(null);
    },
    [editor, controller],
  );

  const startStorm = useCallback(
    (nodeId: string) => {
      const sim = createStormSimulation(getDiagram(), nodeId);
      setPanel({ open: true, kind: "sims", sim });
      runDraft(sim);
    },
    [getDiagram, runDraft],
  );

  const showEvents = useCallback((nodeId: string | null, open = true) => setEvents({ open, nodeId }), []);

  // ---------------------------------------------------------------- record video

  const [rec, dispatchRec] = useReducer(recordReducer, initialRecordState);
  const capturing = isCapturing(rec.phase);

  // ---------------------------------------------------------------- slow motion

  const slow = useSlowMotion({
    controller,
    store,
    setViewport,
    presenting,
    reducedMotion,
    panelOpen: panel.open,
    capturing,
  });
  useLayoutEffect(() => {
    slowRef.current = slow;
  });
  if (slowPath !== slow.path) setSlowPath(slow.path);
  const startSlow = slow.start;
  /** The trace card's "Slow motion" (and the palette's): this message's journey, paced. */
  const slowMotionTrace = useCallback(() => {
    const t = controller.getState().trace;
    const source: SlowSource = t?.rootId !== undefined ? { kind: "root", rootId: t.rootId } : { kind: "followed" };
    startSlow(source);
  }, [controller, startSlow]);
  // While slow motion plays, the card is its event list: the replayed journey, the hop being told.
  const slowState = slow.state;
  // A page driving live view from outside (the host-supplied embed) gets the controller and the bar's switch.
  useEffect(() => {
    if (!onSession) return;
    onSession({ controller, selectSimulation });
    return () => onSession(null);
  }, [onSession, controller, selectSimulation]);
  // Simulation switching uses the same availability as the registry's engine-changing actions.
  useLiveSessionHost(
    selectSimulation,
    !!editor && !alwaysOn,
    liveMutationGuard(() => slow.session.active).hint(),
    controller.getState,
  );
  const slowCard = useMemo(() => {
    const script = slowState.script;
    if (slowState.status !== "on" || !script || !slowState.trace) return null;
    const notes = [
      script.unfinished ? `Recorded for ${LOOK_AHEAD_LABEL} of simulated time: ${script.summary.toLowerCase()}.` : "",
      script.duration > PACING.longScript
        ? `This slow motion runs ${formatSpan(script.duration)}: → skips to the next hop.`
        : "",
    ].filter(Boolean);
    return {
      trace: { rootId: slowState.trace.rootId, current: slowState.trace },
      card: {
        playing: slowState.playing,
        row: slowState.row,
        activeRows: slowState.activeRows,
        onToggle: () => slow.session.toggle(),
        onSeek: (key: string) => slow.session.seekRow(key),
        onExit: slow.end,
        hiddenCopies: script.hiddenCopies,
        note: notes.join(" ") || undefined,
      },
    };
  }, [slowState, slow.session, slow.end]);
  /** Opens "Record video" (the panels and the event log close: they'd be in the video). */
  const openRecord = useCallback(() => {
    setPanel((p) => (p.open ? { ...p, open: false } : p));
    setEvents((e) => (e.open ? { ...e, open: false } : e));
    dispatchRec({ type: "open" });
  }, []);
  /** The video is framed to the canvas area: the diagram, its title card and the live overlays. */
  const recordTarget = useCallback(() => {
    const root = store.getState().domNode;
    return root?.closest(".canvas-wrap") ?? root ?? null;
  }, [store]);
  const recordTitle = useCallback(() => getDiagram().title, [getDiagram]);

  // ---------------------------------------------------------------- inputs & capacity

  const [forcedOverlay] = useState(params.capacity);
  const overlayPref = useCapacityOverlay();
  const showCapacity = forcedOverlay ?? overlayPref;
  const planDiagram = controller.currentDiagram;
  const freePlan = useMemo(() => freePlaySimulation(planDiagram, state.inputs), [planDiagram, state.inputs]);
  const plan = state.running ?? freePlan;
  // The run's outages (timeline chaos, Kill, Pause) as a stable key: the callout says "down", not "Healthy".
  const outageKey = JSON.stringify(
    Object.entries(state.snapshot.nodes)
      .filter(([, n]) => n.status !== "up")
      .map(([id, n]) => [id, n.status])
      .sort(),
  );
  const runStatus = useMemo(() => {
    const status: Record<string, NodeStatus> = Object.fromEntries(planDiagram.nodes.map((n) => [n.id, "up"]));
    for (const [id, st] of JSON.parse(outageKey) as [string, NodeStatus][]) status[id] = st;
    return status;
  }, [outageKey, planDiagram]);
  // Recomputed only when the plan or an outage changes (sliders, saves, edits, chaos), never per frame.
  const capacity = useMemo(
    () => (showCapacity || capacityOpen ? capacityView(planDiagram, plan, runStatus) : null),
    [showCapacity, capacityOpen, planDiagram, plan, runStatus],
  );

  // The panel shows the heat map for this session only; leaving live view restores the preference.
  useEffect(() => () => capacityOverlay.endSession(), []);
  const openCapacity = useCallback((open = true) => {
    if (open) capacityOverlay.showForSession();
    setPanel((p) => (open ? { open: true, kind: "capacity", sim: null } : { ...p, open: false }));
  }, []);

  const closeCapacity = useCallback(() => openCapacity(false), [openCapacity]);

  /** Apply a bottleneck fix as one undoable edit: to the saved simulation, or the diagram in free play. */
  const applyFix = useCallback(
    (fix: CapacityFix) => {
      if (slowRef.current?.session.active) return;
      const st = controller.getState();
      const base = st.simulation;
      const inputs = inputsWithoutFix(st.inputs, fix);
      const saved = base && simsRef.current.find((x) => x.id === base.id);
      if (editor && base && saved && draftRef.current?.id !== base.id) {
        const next = withFix(saved, fix);
        editor.updateMeta({
          simulations: (editor.getDiagram().simulations ?? []).map((x) => (x.id === next.id ? next : x)),
        });
        controller.setInputs(inputs);
        controller.setBase(next);
      } else if (base) {
        // An unsaved draft (or the Lab): the fix joins it, to be saved with it.
        const next = withFix(base, fix);
        if (draftRef.current?.id === base.id) {
          setDraft(next);
          draftRef.current = next;
        }
        controller.setInputs(inputs);
        controller.setBase(next);
      } else if (editor) {
        const merge = "capacity:fix:" + Date.now();
        for (const c of fix.changes) editor.setNodeProps(c.nodeId, { [c.key]: c.to }, { merge });
        const d = controller.currentDiagram;
        controller.setInputs(inputs);
        controller.updateDiagram({
          ...d,
          nodes: d.nodes.map((n) => {
            const own = fix.changes.filter((c) => c.nodeId === n.id);
            return own.length
              ? { ...n, props: { ...n.props, ...Object.fromEntries(own.map((c) => [c.key, c.to])) } }
              : n;
          }),
        });
      } else {
        const props = structuredClone(inputs.props);
        for (const c of fix.changes) props[c.nodeId] = { ...props[c.nodeId], [c.key]: c.to };
        controller.setInputs({ ...inputs, props });
      }
      if (editor) flash("Applied the fix: " + fix.label + " (undo with Ctrl+Z).");
    },
    [controller, editor, flash],
  );

  /** "Nobody reads X" › Add a consumer: a service reading it, one undoable edit (the run restarts with it). */
  const addReader = useCallback(
    (brokerId: string) => {
      if (slowRef.current?.session.active || !editor) return;
      if (!addConsumer(editor, brokerId)) return;
      sayConsumerAdded(editor, brokerId);
      // It lands one gap downstream, maybe past the view's edge: bring it in, clear of an open panel (as addEntry).
      window.setTimeout(() => {
        const padding = capacityOpen
          ? { ...(FULL_FIT.padding as typeof NOTE_PADDING), right: "440px" as const }
          : undefined;
        void fitView({ ...FULL_FIT, ...(padding ? { padding } : {}), duration: motionMs(FULL_FIT.duration ?? 0) });
      }, 260);
    },
    [editor, capacityOpen, fitView],
  );

  /** "Save to simulation" (or "Save to diagram" in free play): one undoable edit, then the inputs reset. */
  const saveInputs = useCallback(() => {
    if (slowRef.current?.session.active) return;
    if (!editor) return;
    const st = controller.getState();
    const candidate = capacitySaveCandidate(editor.getDiagram(), st.simulation, st.inputs);
    const error = capacitySaveError(candidate.diagram);
    setCapacityError(error);
    if (error) return;
    controller.flush();
    if (candidate.saved) {
      if (saveSimulation(candidate.saved)) controller.commitInputs(candidate.saved, candidate.diagram);
      return;
    }
    const merge = "capacity:save:" + Date.now();
    for (const [id, props] of Object.entries(candidate.patches)) editor.setNodeProps(id, props, { merge });
    onSaveDiagram?.(candidate.diagram);
    controller.commitInputs(null, candidate.diagram);
    flash("Saved rates and sizes to the diagram (undo with Ctrl+Z).");
  }, [controller, editor, saveSimulation, flash, onSaveDiagram]);

  /**
   * "Traffic into X" when nothing sends traffic yet: an upstream source one gap before the node,
   * connected to it (one undoable edit), then the cursor in its rate field.
   */
  const addEntry = useCallback(
    (targetId: string) => {
      if (!editor) return;
      const target = editor.getNode(targetId);
      if (!target) return;
      // The palette's collision-aware placement, upstream: never on top of a node already there.
      const boxes = [...store.getState().nodeLookup.values()]
        .filter((n) => n.type === "diagram" && !n.hidden)
        .map((n) => ({
          id: n.id,
          x: n.internals.positionAbsolute.x,
          y: n.internals.positionAbsolute.y,
          width: n.measured.width ?? 220,
          height: n.measured.height ?? 72,
        }));
      const from = boxes.find((b) => b.id === targetId) ?? { x: target.x, y: target.y, width: 220, height: 72 };
      const direction = editor.getDiagram().direction === "TB" ? "TB" : "LR";
      const at = placeNextTo(from, { width: from.width, height: from.height }, boxes, direction, "upstream");
      // Same tick: the history debounce records the node, its label and its edge as one undo step.
      const stencil = ENTRY_STENCILS.find((x) => stencilRole(x) === "source") ?? ENTRY_STENCILS[0];
      const id = editor.addNode(stencil, at);
      editor.updateNode(id, { label: "Incoming traffic", sublabel: undefined });
      editor.connect(id, targetId);
      flash(`Added an entry point into ${target.label || target.id}. Set its rate in msg/s.`);
      // Bring the new node into view beside the panel.
      window.setTimeout(() => {
        const padding = { ...(FULL_FIT.padding as typeof NOTE_PADDING), right: "440px" as const };
        void fitView({ ...FULL_FIT, padding, duration: motionMs(FULL_FIT.duration ?? 0) });
      }, 260);
      // The panel lists it once the session picks up the edit; then the rate field takes the cursor.
      const started = performance.now();
      const focusRate = () => {
        const field = document.querySelector<HTMLInputElement>(`[data-testid="capacity-rate-${CSS.escape(id)}"]`);
        if (field) {
          field.focus();
          field.select();
        } else if (performance.now() - started < 2000) requestAnimationFrame(focusRate);
      };
      requestAnimationFrame(focusRate);
    },
    [editor, store, flash, fitView],
  );

  // While live, the Simulation section leads every context menu.
  useEffect(() => {
    if (!editor) return;
    const builtin = builtinSections.find((x) => x.id === "simulation");
    const off = actionRegistry.registerSection({ id: "simulation", order: 5, title: "Live" });
    return () => {
      off();
      if (builtin) actionRegistry.registerSection(builtin);
    };
  }, [editor]);

  // This is temporary visibility, not a persisted editor preference.
  useEffect(() => {
    onPanelChange?.(panel.open);
    return () => onPanelChange?.(false);
  }, [panel.open, onPanelChange]);

  // Context-menu actions (canvas only).
  useEffect(() => {
    if (!editor) return;
    return actionRegistry.register([
      ...liveActions({
        controller,
        slowMotionActive: () => !!slowRef.current?.session.active,
        openInject: (nodeId, at) => {
          const t = store.getState().transform;
          const rect = store.getState().domNode?.getBoundingClientRect();
          const x = at && rect ? at.x * t[2] + t[0] + rect.left : window.innerWidth / 2;
          const y = at && rect ? at.y * t[2] + t[1] + rect.top : window.innerHeight / 2;
          setInject({ nodeId, x, y });
        },
        startStorm,
        showEvents: (id) => showEvents(id),
        trace: setTrace,
        tracing: () => traceRef.current,
        traceNext: (nodeId) => {
          slowRef.current?.end();
          controller.traceNext(nodeId);
        },
        slowMotion: (nodeId) => slowRef.current?.start({ kind: "next", node: nodeId }),
        slowMotionTrace,
        canReplayTrace: () => !!controller.getState().trace?.current && !slowRef.current?.session.on,
        traceSlowest: () => startTrace("slowest"),
        traceDeadLettered: () => startTrace("deadletter"),
        endTrace: () => {
          slowRef.current?.end();
          controller.endTrace();
        },
        tracingMessage: () => controller.getState().trace !== null,
        saveTweaks: (nodeId) => {
          const tweak = controller.getState().tweaks.get(nodeId);
          if (!tweak) return;
          const patch: Record<string, unknown> = { ...tweak.props };
          if (tweak.status) patch.status = tweak.status === "up" ? undefined : tweak.status;
          editor.setNodeProps(nodeId, patch);
          controller.clearTweaks(nodeId);
          flash("Saved the live changes to the diagram (undo with Ctrl+Z).");
        },
        messageType: (nodeId) => suggestedMessageType(getDiagram(), nodeId),
        openRecord,
      }),
      {
        id: "sim.inputs",
        section: "simulation",
        targets: ["canvas"],
        modes: ["live"],
        paletteOnly: true,
        label: "Edit Inputs & capacity",
        icon: "sliders",
        ...liveMutationGuard(() => !!slowRef.current?.session.active),
        run: () => openCapacity(),
      },
      {
        id: "sim.capacity-fix",
        section: "simulation",
        targets: ["canvas"],
        modes: ["live"],
        paletteOnly: true,
        label: "Apply capacity fix",
        icon: "check",
        when: () => !!capacity?.fix,
        ...liveMutationGuard(() => !!slowRef.current?.session.active),
        run: () => {
          if (capacity?.fix) applyFix(capacity.fix);
        },
      },
    ]);
  }, [
    editor,
    controller,
    store,
    startStorm,
    showEvents,
    getDiagram,
    flash,
    openRecord,
    startTrace,
    slowMotionTrace,
    capacity,
    applyFix,
    openCapacity,
  ]);

  // Keyboard: Space plays / pauses (or continues a pausing note), Enter continues, Esc backs out
  // one level: a selection, a message trace, a highlighted path, then live view itself. Open menus,
  // dialogs, panels and inline editors get theirs first; presentation handles its own Esc (App).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      // Slow motion has its own keys (useSlowMotion): Space, ← →, and Esc back to live.
      const slowing = slowRef.current?.session.active;
      if (slowing && (e.key === " " || (e.key === "Escape" && !document.querySelector(SELECTED)))) return;
      const t = e.target;
      if (e.key === "Escape") {
        // A recording owns Esc (it stops the recording, see Recorder).
        if (isRecordingActive()) return;
        if (isEditableTarget(t) || document.querySelector(ESC_OWNERS)) return;
        if (document.querySelector(SELECTED)) {
          // The canvas clears its selection when it has focus; otherwise clear it here (no dead end).
          if (!inCanvas(t) || (t instanceof Element && t.closest('[data-testid="trace-card"]')))
            editor?.clearSelection();
          return;
        }
        // The trace comes before presentation: stop App from also leaving presentation.
        if (controller.getState().trace) {
          e.stopPropagation();
          controller.endTrace();
          return;
        }
        if (presenting) return;
        if (traceRef.current) setTrace(null);
        else if (!alwaysOn) onExit();
        return;
      }
      if (isEditableTarget(t) || (t instanceof Element && t.closest("button, select, a, [data-editor-overlay]")))
        return;
      const waiting = controller.getState().run?.waiting;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (waiting) controller.resume();
        else controller.togglePlaying();
      } else if (e.key === "Enter" && waiting) {
        e.preventDefault();
        controller.resume();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller, presenting, alwaysOn, onExit, editor]);

  const ui = useMemo<LiveUi>(
    () => ({
      controller,
      presenting,
      canEdit: !!editor,
      diagram: getDiagram,
      simulations,
      draft,
      selectSimulation,
      openPanel: (sim) => setPanel({ open: true, kind: "sims", sim: sim ?? null }),
      panelOpen: panel.open,
      capacityOpen,
      openCapacity,
      events,
      showEvents,
      notice: shownNotice,
      exit: alwaysOn ? null : onExit,
      openRecord,
      startTrace,
      slowmo: slow.session,
      action: (id) => {
        if (!editor) return undefined;
        const row = actionRegistry
          .build({ editor, target: "canvas", mode: "live", surface: "palette", selection: editor.getSelection() })
          .find((row) => row.type === "item" && row.id === id);
        return row?.type === "item" ? row : undefined;
      },
    }),
    [
      slow.session,
      controller,
      presenting,
      editor,
      getDiagram,
      simulations,
      draft,
      selectSimulation,
      panel.open,
      capacityOpen,
      openCapacity,
      events,
      showEvents,
      shownNotice,
      onExit,
      openRecord,
      alwaysOn,
      startTrace,
    ],
  );

  return (
    <LiveContext.Provider value={ui}>
      <ViewportPortal>
        <canvas
          key={`base-${rendererKind}`}
          data-renderer={rendererKind}
          ref={setCanvas}
          className="lv-canvas"
          data-testid="live-canvas"
          aria-hidden
        />
        <canvas
          key={`over-${rendererKind}`}
          ref={setOverlay}
          className="lv-canvas lv-canvas-over"
          data-testid="live-canvas-over"
          aria-hidden
        />
        <NodeBadges state={state} presenting={presenting} capacity={showCapacity ? capacity : null} />
      </ViewportPortal>
      <div
        className={`lv-hud${presenting ? " is-presenting" : ""}${panel.open ? " has-panel" : ""}`}
        data-testid="live-hud"
      >
        {trace && (
          <div className="lv-trace-chip" data-testid="live-trace">
            <LiveIcon name="target" size={13} /> Highlighting everything downstream of this edge
            <button onClick={() => setTrace(null)} data-testid="live-trace-clear" aria-label="Clear highlight">
              <LiveIcon name="close" size={12} />
            </button>
          </div>
        )}
        {showCapacity && capacity && !capacityOpen && (
          <BottleneckCallout
            view={capacity}
            floating
            onApply={applyFix}
            disabledHint={liveMutationGuard(() => slow.session.active).hint()}
            onOpenPanel={presenting ? undefined : () => openCapacity()}
            onAddConsumer={editor && !presenting ? addReader : undefined}
          />
        )}
        {slowCard && !capturing ? (
          <TraceCard
            trace={slowCard.trace}
            diagram={controller.currentDiagram}
            now={slowCard.trace.current?.endedAt ?? state.snapshot.time}
            onClose={slow.end}
            onSequence={() => slowCard.trace.current && setSequence(slowCard.trace.current)}
            room={cardRoom}
            slowmo={slowCard.card}
          />
        ) : (
          state.trace &&
          !capturing && (
            <TraceCard
              trace={state.trace}
              diagram={controller.currentDiagram}
              now={state.snapshot.time}
              onClose={() => {
                slow.end();
                controller.endTrace();
              }}
              onSequence={() => state.trace?.current && setSequence(state.trace.current)}
              onSendOne={sendOne}
              room={cardRoom}
              onSlowMotion={state.trace.current ? slowMotionTrace : undefined}
              waitingText={
                slow.state.status === "armed"
                  ? `${slow.state.armedAt ? `Waiting for the next message at ${controller.currentDiagram.nodes.find((n) => n.id === slow.state.armedAt)?.label ?? slow.state.armedAt}` : "Waiting for the next message"}: slow motion starts when it comes…`
                  : undefined
              }
            />
          )
        )}
        <SlowCaption slow={slow.session} />
        {/* Live's narration waits with live while slow motion plays. */}
        {slow.state.status !== "on" && <NoteCallout state={state} />}
        {events.open && !capturing && <EventLog state={state} />}
        {/* While recording, the indicator (Stop, Esc) stands in for the bar. */}
        {!capturing && <ControlBar state={state} />}
      </div>
      {capacityOpen && capacity && (
        <CapacityPanel
          key={state.simulation?.id ?? "free"}
          controller={controller}
          disabledHint={liveMutationGuard(() => slow.session.active).hint()}
          diagram={planDiagram}
          base={state.simulation}
          inputs={state.inputs}
          running={state.running}
          scale={state.scale}
          error={capacityError}
          onChange={clearCapacityError}
          view={capacity}
          onClose={closeCapacity}
          onApplyFix={applyFix}
          onAddConsumer={editor && !presenting ? addReader : undefined}
          onSave={editor ? saveInputs : undefined}
          onAddEntry={editor && !presenting ? addEntry : undefined}
        />
      )}
      {panel.open && panel.kind === "sims" && editor && (
        <SimPanel
          key={panel.sim?.id ?? "picker"}
          initial={panel.sim}
          state={state}
          onClose={() => setPanel({ open: false, kind: "sims", sim: null })}
          onRun={runDraft}
          onSave={saveSimulation}
          onDelete={deleteSimulation}
          onOpen={showSimulation}
        />
      )}
      {inject && <InjectDialog request={inject} onClose={() => setInject(null)} />}
      {sequence && (
        <Suspense fallback={null}>
          <SequenceDialog
            trace={sequence}
            diagram={controller.currentDiagram}
            theme={theme}
            onClose={() => setSequence(null)}
          />
        </Suspense>
      )}
      <Recorder
        rec={rec}
        dispatch={dispatchRec}
        controller={controller}
        state={state}
        target={recordTarget}
        title={recordTitle}
        presenting={presenting}
        canPresent={!!editor && !alwaysOn}
        slowmo={slow.session}
      />
    </LiveContext.Provider>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** The toast after Add a consumer, with Undo. */
function sayConsumerAdded(editor: EditorApi, brokerId: string): void {
  const name = editor.getNode(brokerId)?.label || brokerId;
  notify(`Added a consumer of ${name}.`, {
    action: { label: "Undo", run: () => editor.undo(), testId: "add-consumer-undo", undoes: true },
  });
}

/** Edit mode's capacity heat map: the diagram's own rates and sizes, with the bottleneck callout. */
export function EditCapacity({ editor, presenting }: { editor: EditorApi; presenting: boolean }) {
  const nodes = useStore((st) => st.nodes);
  const edges = useStore((st) => st.edges);
  // Positions don't change capacity: key the analysis on what does.
  const structure = useMemo(
    () =>
      JSON.stringify([
        nodes.map((n) => (n.type === "diagram" ? [n.id, n.data.stencil, n.data.label, n.data.props ?? null] : n.id)),
        edges.map((e) => edgeSemanticSignature({ id: e.id, from: e.source, to: e.target, ...e.data })),
      ]),
    [nodes, edges],
  );
  const view = useMemo(() => {
    if (!structure) return null;
    const d = editor.getDiagram();
    return capacityView(d, freePlaySimulation(d, emptyInputs()));
  }, [structure, editor]);
  const apply = useCallback(
    (fix: CapacityFix) => {
      const merge = "capacity:fix:" + Date.now();
      for (const c of fix.changes) editor.setNodeProps(c.nodeId, { [c.key]: c.to }, { merge });
      notify("Applied the fix: " + fix.label + ".", {
        action: { label: "Undo", run: () => editor.undo(), testId: "capacity-fix-undo", undoes: true },
      });
    },
    [editor],
  );
  if (!view) return null;
  return (
    <>
      <ViewportPortal>
        <CapacityLayer view={view} presenting={presenting} />
      </ViewportPortal>
      <div className={"cap-hud" + (presenting ? " is-presenting" : "")}>
        <BottleneckCallout
          view={view}
          floating
          onApply={presenting ? undefined : apply}
          onAddConsumer={presenting ? undefined : (id) => addConsumer(editor, id) && sayConsumerAdded(editor, id)}
        />
      </div>
    </>
  );
}
