import { useCallback, useEffect, useState } from "react";
import { useNodesInitialized, useStore } from "@xyflow/react";
import "../styles/live.css";
import "../styles/capacity.css";
import type { DiagramFile, Simulation } from "../model/types";
import type { EditorApi } from "../editor/types";
import { isEditableTarget } from "../editor/shortcuts";
import { useLiveHost } from "../palette/host";
import { lazyComponent, whenIdle } from "../lib/lazyLoad";
import { readLiveParams, writeLiveParams, type LiveParams } from "./urlParams";
import { capacityOverlay, useCapacityOverlay } from "./capacityOverlay";
import { isRecordingActive } from "./record/framing";
import type { LiveInputs } from "./capacityModel";

// Live view's always-mounted part: the Live toggle, its keys (L, C) and the URL. The session itself (the
// simulation, renderers, panels, slow motion, recording) and the edit-mode capacity heat map are their own
// chunk (./LiveSession), so the canvas's first view doesn't download them.

const LiveSession = lazyComponent(() => import("./LiveSession").then((m) => m.LiveSession));
const EditCapacity = lazyComponent(() => import("./LiveSession").then((m) => m.EditCapacity));

export interface LiveViewProps {
  /** The canvas editor. Absent in the Lab: no authoring, no saving, no context-menu actions. */
  editor?: EditorApi;
  presenting: boolean;
  /** The diagram's saved simulations (from the canvas meta), so edits re-render the picker. */
  simulations?: Simulation[];
  /** Lab: the diagram to simulate when there's no editor. */
  diagram?: DiagramFile;
  /** Start options. Default: read from the URL (`live`, `sim`, `speed`, `paused`, `traffic`). */
  initial?: Partial<LiveParams> & {
    traffic?: boolean;
    seekMs?: number;
    /** Open a side panel at start (Lab presets). */
    panel?: "capacity";
    /** Force the capacity heat map on or off for this view (Lab presets), ignoring the preference. */
    capacity?: boolean;
    /** Start with these Inputs & capacity values. */
    inputs?: Partial<LiveInputs>;
    /** Start a message trace (Lab presets): the next message, or the next one to dead-letter. */
    trace?: "next" | "deadletter";
  };
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

export function LiveView(props: LiveViewProps) {
  const enabled = !props.readOnly || new URLSearchParams(window.location.search).get("live") === "1";
  const [params] = useState(() => ({
    ...(props.alwaysOn ? { live: true, sim: null, speed: null, paused: false } : readLiveParams()),
    ...props.initial,
  }));
  const [live, setLive] = useState(enabled && (params.live || !!props.alwaysOn));
  const [firstSession, setFirstSession] = useState(true);
  const toggle = useCallback(() => setLive((l) => !l), []);
  const goLive = useCallback(() => setLive(true), []);
  // "Toggle live" and "Run simulation" in the command palette.
  useLiveHost(toggle, goLive, enabled && !props.alwaysOn && !!props.editor);
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
      // A recording in progress keeps live view (Esc or Stop ends the recording first).
      if (isRecordingActive()) return;
      // Buttons (including the live bar's) don't take text, so L still works when they have focus.
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, props.alwaysOn, enabled]);

  // "C" shows or hides the capacity heat map (edit and live).
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      capacityOverlay.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  // The session's code: as soon as live view is asked for, else once the canvas is idle, so the toggle (or L)
  // starts it at once.
  useEffect(() => {
    if (!enabled) return;
    if (!live) return whenIdle(LiveSession.preload);
    LiveSession.preload();
  }, [enabled, live]);

  // "Show capacity" on the canvas right-click lives under Show ▸ (builtinActions), with Grid and Minimap.
  const overlayOn = useCapacityOverlay();

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
          onPointerEnter={LiveSession.preload}
          onFocus={LiveSession.preload}
          aria-pressed={live}
          title={
            live
              ? "Back to editing (L or Esc)"
              : props.simulations?.length
                ? `Go live: watch messages flow, or replay ${props.simulations.length === 1 ? "the saved simulation" : `${props.simulations.length} saved simulations`} (L)`
                : "Go live: watch messages flow through this diagram (L)"
          }
          data-testid="live-toggle"
        >
          <span className="lv-toggle-dot" aria-hidden />
          Live
          <kbd>L</kbd>
        </button>
      )}
      {!live && ready && overlayOn && props.editor && (
        <EditCapacity editor={props.editor} presenting={props.presenting} />
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
