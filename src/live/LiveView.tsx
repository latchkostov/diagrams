import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ViewportPortal,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
  type FitViewOptions,
} from "@xyflow/react";
import "../styles/live.css";
import type { DiagramFile, Simulation } from "../model/types";
import type { EditorApi } from "../editor/types";
import { actionRegistry, builtinSections } from "../editor/actions";
import { isEditableTarget } from "../editor/shortcuts";
import { useSettings } from "../harness/settings";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { LiveController } from "./controller";
import { LiveContext, useLiveState, type LiveUi } from "./context";
import { Decorator } from "./decorations";
import { downstreamOfEdge, edgesWithin } from "./graph";
import { liveActions } from "./liveActions";
import { DEFAULT_TOKENS, ParticleRenderer, readParticleTokens, type RenderEnv } from "./particleRenderer";
import { createStormSimulation, suggestedMessageType } from "./storm";
import { readLiveParams, writeLiveParams, type LiveParams } from "./urlParams";
import { ControlBar } from "./ControlBar";
import { NodeBadges } from "./NodeBadges";
import { NoteCallout } from "./NoteCallout";
import { EventLog } from "./EventLog";
import { InjectDialog, type InjectRequest } from "./InjectDialog";
import { SimPanel } from "./SimPanel";
import { LiveIcon } from "./icons";
import { LIVE_BAR_SPACE, LIVE_BAR_VAR } from "./layout";

export interface LiveViewProps {
  /** The canvas editor. Absent in the Lab: no authoring, no saving, no context-menu actions. */
  editor?: EditorApi;
  presenting: boolean;
  /** The diagram's saved simulations (from the canvas meta), so edits re-render the picker. */
  simulations?: Simulation[];
  /** Lab: the diagram to simulate when there's no editor. */
  diagram?: DiagramFile;
  /** Start options. Default: read from the URL (`live`, `sim`, `speed`, `paused`, `traffic`). */
  initial?: Partial<LiveParams> & { traffic?: boolean; seekMs?: number };
  /** Lab stages are always live and hide the toggle. */
  alwaysOn?: boolean;
  /** Read-only embeds expose live playback only when explicitly requested in the URL. */
  readOnly?: boolean;
  /** Tells the canvas when live mode turns on or off (it folds the side panels away). */
  onLiveChange?: (live: boolean) => void;
  /** Persist an explicit simulation save before reporting success to the user. */
  onSaveDiagram?: (diagram: DiagramFile) => void;
  /** Temporarily fold the inspector while authoring without changing its saved preference. */
  onPanelChange?: (open: boolean) => void;
}

const UI_MS = 125;
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
export function LiveView(props: LiveViewProps) {
  const enabled = !props.readOnly || new URLSearchParams(window.location.search).get("live") === "1";
  const [params] = useState(() => ({
    ...(props.alwaysOn ? { live: true, sim: null, speed: null, paused: false } : readLiveParams()),
    ...props.initial,
  }));
  const [live, setLive] = useState(enabled && (params.live || !!props.alwaysOn));
  const [firstSession, setFirstSession] = useState(true);
  const toggle = useCallback(() => setLive((l) => !l), []);
  // React Flow fills its store in an effect; start the session once nodes are there and measured.
  const mounted = useStore((s) => s.domNode !== null);
  const initialized = useNodesInitialized();
  const empty = useStore((s) => s.nodes.length === 0);
  // Latched: adding a node briefly un-initializes React Flow, which mustn't end the session.
  const [ready, setReady] = useState(false);
  if (!ready && mounted && (initialized || empty)) setReady(true);
  if (!live && firstSession) setFirstSession(false);

  // "L" toggles live mode anywhere on the canvas.
  useEffect(() => {
    if (props.alwaysOn || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      // Buttons (including the live bar's) don't take text, so L still works when they have focus.
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, props.alwaysOn, enabled]);

  const onLiveChange = props.onLiveChange;
  useEffect(() => onLiveChange?.(live), [live, onLiveChange]);

  useEffect(() => {
    if (!live) {
      if (props.editor) writeLiveParams(false, null);
    }
  }, [live, props.editor]);

  return (
    <>
      {enabled && !props.alwaysOn && (
        <button
          className={`lv-toggle${live ? " is-on" : ""}${props.presenting ? " is-presenting" : ""}`}
          onClick={toggle}
          aria-pressed={live}
          title={live ? "Leave live view (L)" : "Watch messages flow through this diagram (L)"}
          data-testid="live-toggle"
        >
          <span className="lv-toggle-dot" aria-hidden />
          Live
          <kbd>L</kbd>
        </button>
      )}
      {live && ready && (
        <LiveSession
          {...props}
          params={firstSession ? params : { ...params, live: true, sim: null, speed: null, paused: false }}
          onExit={() => setLive(false)}
        />
      )}
    </>
  );
}

interface SessionProps extends LiveViewProps {
  params: Partial<LiveParams> & { traffic?: boolean; seekMs?: number };
  onExit: () => void;
}

function LiveSession({
  editor,
  presenting,
  simulations: simsProp,
  diagram,
  params,
  onExit,
  alwaysOn,
  onSaveDiagram,
  onPanelChange,
}: SessionProps) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const { fitView } = useReactFlow<FlowNode, DiagramFlowEdge>();
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
    if (sim && params.seekMs) c.seek(params.seekMs);
    if (!params.paused) c.setPlaying(true);
    return c;
  });
  const state = useLiveState(controller);

  const [panel, setPanel] = useState<{ open: boolean; sim: Simulation | null }>({ open: false, sim: null });
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
    else if (JSON.stringify(next) !== JSON.stringify(cur)) controller.selectSimulation(next);
  }, [simulations, controller]);

  // Mirror the live state into the URL (canvas only) so the address is a shareable live link.
  const simId = state.simulation && state.simulation.id !== draft?.id ? state.simulation.id : null;
  useEffect(() => {
    if (editor) writeLiveParams(true, simId);
  }, [editor, simId]);

  // ---------------------------------------------------------------- spotlight (notes, trace)

  const note = state.run?.note;
  const noteKey = note ? `${state.generation}:${note.atMs}:${note.text}` : "";
  // The controller publishes fresh note objects each tick; keep the focus stable for camera effects.
  const focusKey = JSON.stringify(note?.focus ?? []);
  const noteFocus = useMemo(() => JSON.parse(focusKey) as string[], [focusKey]);
  const spotlight = (() => {
    const d = controller.currentDiagram;
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
          const padding = panelOpenRef.current ? { ...NOTE_PADDING, right: "440px" as const } : NOTE_PADDING;
          void fitView({
            ...NOTE_FIT,
            padding,
            nodes: focus.map((id) => ({ id })),
            duration: reducedMotion ? 0 : NOTE_FIT.duration,
          });
        } else if (zoomedForNote.current) {
          zoomedForNote.current = false;
          void fitView({ ...FULL_FIT, duration: reducedMotion ? 0 : FULL_FIT.duration });
        }
      },
      panelOpenRef.current ? 320 : 160,
    );
    return () => window.clearTimeout(t);
  }, [noteKey, noteFocus, fitView, reducedMotion]);

  // The authoring panel covers the right of the pane: fit the diagram into what's left (unless a
  // note is steering the camera).
  const panelFitted = useRef(false);
  useEffect(() => {
    if (zoomedForNote.current || panel.open === panelFitted.current) return;
    panelFitted.current = panel.open;
    const t = window.setTimeout(() => {
      if (zoomedForNote.current) return;
      const padding = panel.open
        ? { ...(FULL_FIT.padding as typeof NOTE_PADDING), right: "440px" as const }
        : FULL_FIT.padding;
      void fitView({ ...FULL_FIT, padding, duration: reducedMotion ? 0 : FULL_FIT.duration });
    }, 320);
    return () => window.clearTimeout(t);
  }, [panel.open, fitView, reducedMotion]);

  // ---------------------------------------------------------------- the frame loop

  // A callback ref: ViewportPortal renders nothing until React Flow's DOM exists.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
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
  const rendererRef = useRef<ParticleRenderer | null>(null);
  const renderOptsRef = useRef(renderOpts);
  useLayoutEffect(() => {
    renderOptsRef.current = renderOpts;
    rendererRef.current?.setOptions(renderOpts);
  }, [renderOpts]);

  useEffect(() => {
    const root = store.getState().domNode;
    if (!canvas || !root) return;
    const env: RenderEnv = {
      transform: () => store.getState().transform,
      size: () => ({ width: store.getState().width, height: store.getState().height }),
      edgePath: (id) =>
        root.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(id)}"] path.react-flow__edge-path`),
      nodeRect: (id) => {
        const n = store.getState().nodeLookup.get(id);
        if (!n) return null;
        return {
          x: n.internals.positionAbsolute.x,
          y: n.internals.positionAbsolute.y,
          width: n.measured.width ?? 0,
          height: n.measured.height ?? 0,
        };
      },
    };
    // Fit-view padding elsewhere can reserve room for the control bar.
    root.style.setProperty(LIVE_BAR_VAR, `${LIVE_BAR_SPACE}px`);
    const renderer = new ParticleRenderer(canvas, env, renderOptsRef.current);
    rendererRef.current = renderer;
    const decorator = new Decorator(root);
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let generation = controller.getState().generation;
    let stats = 0;
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
      renderer.draw(snap, now);
      if (now - lastUi >= UI_MS) {
        lastUi = now;
        if (controller.isPlaying) controller.publish();
        decorator.apply({ snapshot: snap, spotlight: spotlightRef.current });
        if (++stats % 2 === 0) canvas.dataset.particles = String(renderer.drawn);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      decorator.clear();
      root.style.removeProperty(LIVE_BAR_VAR);
      rendererRef.current = null;
    };
    // renderOpts changes are applied through setOptions above, without restarting the loop.
  }, [controller, store, canvas]);

  // ---------------------------------------------------------------- commands

  const selectSimulation = useCallback(
    (id: string | null) => {
      const sim = id
        ? draftRef.current?.id === id
          ? draftRef.current
          : simsRef.current.find((s) => s.id === id)
        : null;
      setTrace(null);
      controller.selectSimulation(sim ?? null);
      if (sim) controller.setTraffic(false);
      controller.setPlaying(true);
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
      editor.updateMeta({ simulations: list });
      onSaveDiagram?.({ ...editor.getDiagram(), simulations: list });
      if (draftRef.current?.id === sim.id) {
        setDraft(null);
        draftRef.current = null;
      }
      flash(`Saved “${sim.title}” to this diagram.`);
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
      setPanel({ open: true, sim });
      runDraft(sim);
    },
    [getDiagram, runDraft],
  );

  const showEvents = useCallback((nodeId: string | null, open = true) => setEvents({ open, nodeId }), []);

  // While live, the Simulation section leads every context menu.
  useEffect(() => {
    if (!editor) return;
    const builtin = builtinSections.find((x) => x.id === "simulation");
    const off = actionRegistry.registerSection({ id: "simulation", order: 5 });
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
    return actionRegistry.register(
      liveActions({
        controller,
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
      }),
    );
  }, [editor, controller, store, startStorm, showEvents, getDiagram, flash]);

  // Keyboard: Space plays / pauses (or continues a pausing note), Enter continues, Esc clears a trace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
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
      } else if (e.key === "Escape" && traceRef.current) {
        setTrace(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller]);

  const ui = useMemo<LiveUi>(
    () => ({
      controller,
      presenting,
      canEdit: !!editor,
      diagram: getDiagram,
      simulations,
      draft,
      selectSimulation,
      openPanel: (sim) => setPanel({ open: true, sim: sim ?? null }),
      panelOpen: panel.open,
      events,
      showEvents,
      notice,
      exit: alwaysOn ? null : onExit,
    }),
    [
      controller,
      presenting,
      editor,
      getDiagram,
      simulations,
      draft,
      selectSimulation,
      panel.open,
      events,
      showEvents,
      notice,
      onExit,
      alwaysOn,
    ],
  );

  return (
    <LiveContext.Provider value={ui}>
      <ViewportPortal>
        <canvas ref={setCanvas} className="lv-canvas" data-testid="live-canvas" aria-hidden />
        <NodeBadges state={state} presenting={presenting} />
      </ViewportPortal>
      <div
        className={`lv-hud${presenting ? " is-presenting" : ""}${panel.open ? " has-panel" : ""}`}
        data-testid="live-hud"
      >
        {trace && (
          <div className="lv-trace-chip" data-testid="live-trace">
            <LiveIcon name="target" size={13} /> Tracing downstream of this edge
            <button onClick={() => setTrace(null)} data-testid="live-trace-clear" aria-label="Clear trace">
              <LiveIcon name="close" size={12} />
            </button>
          </div>
        )}
        <NoteCallout state={state} />
        {events.open && <EventLog state={state} />}
        <ControlBar state={state} />
      </div>
      {panel.open && editor && (
        <SimPanel
          key={panel.sim?.id ?? "picker"}
          initial={panel.sim}
          state={state}
          onClose={() => setPanel({ open: false, sim: null })}
          onRun={runDraft}
          onSave={saveSimulation}
          onDelete={deleteSimulation}
        />
      )}
      {inject && <InjectDialog request={inject} onClose={() => setInject(null)} />}
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
