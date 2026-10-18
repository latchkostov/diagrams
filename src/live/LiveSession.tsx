import { ViewportPortal, useStore, useStoreApi } from "@xyflow/react";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { aiDock, collapseDock } from "../ai/ui/dock";
import { useCameraController } from "../canvas/camera";
import { placeNextTo } from "../canvas/placement";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { actionRegistry, builtinSections } from "../editor/actions";
import { useSettings } from "../harness/settings";
import { useLocale } from "../i18n";
import { notify } from "../interop/ui/toast";
import type { DiagramFile, Simulation } from "../model/types";
import { useLiveSessionHost } from "../palette/host";
import { planningHost } from "../planning/host";
import type { MessageTrace, NodeStatus } from "../sim/types";
import { stencilRole } from "../stencils/roles";
import { buildJourney, formatDuration as formatSpan } from "../trace/journey";
import { BottleneckCallout, TroubleCallout } from "./CapacityLayer";
import { CapacityPanel } from "./CapacityPanel";
import { ControlBar } from "./ControlBar";
import { EventLog } from "./EventLog";
import { InjectDialog, type InjectRequest } from "./InjectDialog";
import { NodeBadges } from "./NodeBadges";
import { NoteCallout } from "./NoteCallout";
import { SimPanel } from "./SimPanel";
import { TraceCard } from "./TraceCard";
import {
  capacityView,
  emptyInputs,
  freePlaySimulation,
  inputsWithoutFix,
  withFix,
  type CapacityFix,
} from "./capacityModel";
import { capacityOverlay, useCapacityOverlay } from "./capacityOverlay";
import { capacitySaveError } from "./capacityPersistence";
import { LiveContext, useLiveState, type LiveUi, type TraceChoice } from "./context";
import { LiveController } from "./controller";
import { downstreamOfEdge, edgesWithin } from "./graph";
import { LiveIcon } from "./icons";
import { liveActions, liveMutationGuard } from "./liveActions";
import { Recorder } from "./record/Recorder";
import { initialRecordState, isCapturing, recordReducer } from "./record/recordModel";
import { useFrameLoop } from "./session/useFrameLoop";
import { useLiveDiagramChanges, useLiveFixes } from "./session/useLiveFixes";
import { useLiveKeyboard } from "./session/useLiveKeyboard";
import { SlowCaption } from "./slowmo/SlowBar";
import { PACING } from "./slowmo/script";
import type { SlowSource } from "./slowmo/session";
import { useSlowMotion, type SlowMotionView } from "./slowmo/useSlowMotion";
import { createStormSimulation, suggestedMessageType } from "./storm";
import { roomUnderCard } from "./traceCardLayout";
// Loaded on first use: the sequence generator, its SVG renderer and Mermaid writer.
const SequenceDialog = lazy(() => import("./SequenceDialog").then((m) => ({ default: m.SequenceDialog })));

import type { LiveSessionHandle, LiveViewProps } from "./LiveView";

// The live session: the simulation, its renderers and panels, slow motion and recording. It loads when live
// view first turns on (or earlier, once the canvas is idle; see LiveView), never with the first view.

/** "Traffic into X": the first of these that starts traffic in the simulation (a source). */
const ENTRY_STENCILS = ["client.user", "client.browser", "generic.webhook"];
const LOOK_AHEAD_LABEL = "30 s";
const DEAD_LETTER_WAIT = "Nothing has dead-lettered yet: the next message that does will be traced.";

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
  // Every move of the view goes through the canvas camera (src/canvas/camera): Live only says what changed.
  const camera = useCameraController();
  if (!camera) throw new Error("LiveSession needs a camera (CameraContext)");
  const locale = useLocale();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
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
  const panelDraft = useRef<Simulation | null>(null);
  const suspendedPanel = useRef<{ sim: Simulation | null } | null>(null);
  const takePanelDraft = useCallback((sim: Simulation | null) => {
    panelDraft.current = sim;
  }, []);
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
  const previousTraffic = useRef(state.traffic);
  useEffect(() => {
    const stopped = previousTraffic.current && !state.traffic;
    previousTraffic.current = state.traffic;
    if (!stopped) return;
    const hint = controller.trafficHint();
    if (!hint) return;
    // Shown right after this commit, not during it (no synchronous re-render from the effect). A microtask, not a
    // timer: a paused clock (presenting a frozen frame, a test's fake clock) must not hold the notice back.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) flash(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [state.traffic, controller, flash]);

  useLiveDiagramChanges({ editor, controller, getDiagram, flash, draftRef, simulations, state, draft, privateDiagram });

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

  // The camera (src/canvas/camera, panePolicy rows L1–L9): Live says what changed in its room, and the policy
  // decides once the pane settles. A note's focus takes the view, and the whole diagram comes back when the
  // story moves on. The side panel and the trace card cover the right of the pane: a fitted view refits into
  // what they leave (a narrated one to the note's focus), a view moved by hand stays put.
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    camera.dispatch({ type: "narration", focus: noteFocus });
  }, [camera, noteKey, noteFocus]);
  useEffect(() => {
    camera.dispatch({ type: "live.panel", open: panel.open });
  }, [camera, panel.open]);
  const cardOpen = !!state.trace;
  useEffect(() => {
    camera.dispatch({ type: "live.card", open: cardOpen });
  }, [camera, cardOpen]);

  // On a phone the side panel and the AI panel share one slot.
  useEffect(() => {
    if (!panel.open) return;
    const phone = window.matchMedia("(max-width: 640px)");
    const fold = () => {
      if (phone.matches) collapseDock();
    };
    fold();
    phone.addEventListener("change", fold);
    return () => phone.removeEventListener("change", fold);
  }, [panel.open]);
  useEffect(
    () =>
      aiDock.subscribe(() => {
        if (!aiDock.get().open || !window.matchMedia("(max-width: 640px)").matches) return;
        // Explicit AI opening owns the phone's one panel slot. Preserve a simulation draft
        // exactly as closing its panel does, so switching back can resume it.
        setPanel((current) => {
          if (!current.open) return current;
          if (current.kind === "sims") suspendedPanel.current = { sim: panelDraft.current };
          return { ...current, open: false };
        });
      }),
    [],
  );

  const { setCanvas, setOverlay, rendererKind } = useFrameLoop({
    controller,
    store,
    theme,
    presenting,
    reducedMotion,
    slowRef,
    spotlightRef,
  });

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
  const shownNotice = state.resourceError ?? (notice === DEAD_LETTER_WAIT && state.trace?.current ? null : notice);
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
      if (!controller.selectSimulation(sim)) return;
      const saved = simsRef.current.some((s) => s.id === sim.id && JSON.stringify(s) === JSON.stringify(sim));
      setDraft(saved ? null : sim);
      draftRef.current = saved ? null : sim;
      setTrace(null);
      controller.setTraffic(false);
      setCapacityError(null);
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
    camera,
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
  const closePanel = useCallback(() => {
    if (!panel.open) return;
    if (panel.kind === "sims") suspendedPanel.current = { sim: panelDraft.current };
    setPanel({ ...panel, open: false });
  }, [panel]);
  useEffect(() => {
    if (!onSession) return;
    onSession({ controller, selectSimulation, closePanel });
    return () => onSession(null);
  }, [onSession, controller, selectSimulation, closePanel]);
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
  const fleetKey = JSON.stringify(
    Object.entries(state.snapshot.nodes).flatMap(([id, n]) => (n.fleet ? [[id, n.fleet.ready]] : [])),
  );
  const readyReplicas = useMemo(() => Object.fromEntries(JSON.parse(fleetKey) as [string, number][]), [fleetKey]);
  // Recomputed only when the plan or an outage changes (sliders, saves, edits, chaos), never per frame.
  const { value: capacity } = useMemo(
    () => ({
      locale,
      value: showCapacity || capacityOpen ? capacityView(planDiagram, plan, runStatus, readyReplicas) : null,
    }),
    [showCapacity, capacityOpen, planDiagram, plan, runStatus, readyReplicas, locale],
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

  const {
    addReader,
    runTroubleAction,
    troubleOnScreen,
    troubleAnnouncement,
    troubleActionHere,
    troubleShown,
    dismissTrouble,
    saveInputs,
  } = useLiveFixes({
    editor,
    controller,
    slowRef,
    camera,
    capacityOpen,
    presenting,
    capturing,
    showCapacity,
    capacity,
    flash,
    showEvents,
    openCapacity,
    saveSimulation,
    setCapacityError,
    onSaveDiagram,
  });

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
      // Bring the new node into view beside the panel, once it's measured.
      camera.dispatch({ type: "live.added", panel: true });
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
    [editor, store, flash, camera],
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

  useLiveKeyboard({ controller, presenting, alwaysOn, onExit, editor, slowRef, traceRef, setTrace });

  const ui = useMemo<LiveUi>(
    () => ({
      applyCapacityFix: applyFix,
      addReader,
      controller,
      presenting,
      canEdit: !!editor,
      diagram: getDiagram,
      simulations,
      draft,
      selectSimulation,
      openPanel: (sim) => {
        // The live bar passes the active run; restore its working copy unless another run was chosen.
        const kept = suspendedPanel.current;
        const restore = kept && (!sim || kept.sim?.id === sim.id);
        suspendedPanel.current = null;
        setPanel({ open: true, kind: "sims", sim: restore ? kept.sim : (sim ?? null) });
      },
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
      applyFix,
      addReader,
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

  useEffect(() => planningHost.publish(ui), [ui]);

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
        {/* Mounted empty first, so the cause is heard when it's written; it changes only with the cause. */}
        <span ref={troubleAnnouncement} className="sr-only" role="status" data-testid="trouble-announce" />
        {troubleOnScreen ? (
          <TroubleCallout
            trouble={troubleOnScreen}
            onShown={troubleShown}
            floating
            onAction={troubleActionHere(troubleOnScreen) ? runTroubleAction : undefined}
            onDismiss={dismissTrouble}
            disabledHint={
              troubleOnScreen.action.kind === "events" || troubleOnScreen.action.kind === "inputs"
                ? undefined
                : liveMutationGuard(() => slow.session.active).hint()
            }
          />
        ) : (
          showCapacity &&
          capacity &&
          !capacityOpen && (
            <BottleneckCallout
              view={capacity}
              floating
              onApply={applyFix}
              disabledHint={liveMutationGuard(() => slow.session.active).hint()}
              onOpenPanel={presenting ? undefined : () => openCapacity()}
              onAddConsumer={editor && !presenting ? addReader : undefined}
            />
          )
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
          onDraftChange={takePanelDraft}
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

export { EditCapacity } from "./session/EditCapacity";
