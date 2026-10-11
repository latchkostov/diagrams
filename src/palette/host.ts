import { useEffect } from "react";
import type { EditorApi } from "../editor/types";

/**
 * What the command palette can act on. The palette is mounted by the app, outside the canvas, so
 * the editable canvas and the live view publish themselves here with one hook call each:
 *
 *   useCanvasHost(editor, { live, enabled: !readOnly });   // CanvasView (./canvasHost, needs React Flow)
 *   useLiveHost(toggle, enabled);                          // LiveView (the Live toggle)
 *   useLiveSessionHost(selectSimulation, enabled);          // LiveView's running session
 *
 * Each hook unpublishes on unmount, so the palette only offers what is on screen.
 */

export interface CanvasHost {
  editor: EditorApi;
  localOnly?: boolean;
  documentId?: string;
  /** The canvas is in live view. */
  live: boolean;
  /** Selects a node and centres the viewport on it. */
  focusNode(id: string): void;
  /**
   * Adds a stencil as one undoable edit: at the viewport centre, or, when exactly one node is
   * selected, next to it (downstream) and connected from it. Returns the new node id.
   */
  addStencil(stencilId: string): string;
}

export interface LiveHost {
  toggle(): void;
}

export interface SessionHost {
  /** Replays a saved simulation in the running session. */
  run(simulationId: string): void;
  disabledHint?: string;
}

interface HostState {
  canvas: CanvasHost | null;
  live: LiveHost | null;
  session: SessionHost | null;
  /** A simulation to start as soon as the live session is up. */
  pendingRun: string | null;
}

let state: HostState = { canvas: null, live: null, session: null, pendingRun: null };
const listeners = new Set<() => void>();

function set(patch: Partial<HostState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** Publishes `value` under `key` and returns the matching unpublish (a no-op if replaced since). */
export function publish<K extends "canvas" | "live" | "session">(key: K, value: NonNullable<HostState[K]>) {
  set({ [key]: value } as Partial<HostState>);
  return () => {
    if (state[key] === value) set({ [key]: null } as Partial<HostState>);
  };
}

export const paletteHost = {
  get: (): HostState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Replays a saved simulation, going live first when needed. False when live view isn't available. */
  runSimulation(id: string): boolean {
    if (state.session) {
      if (state.session.disabledHint) return false;
      state.session.run(id);
      return true;
    }
    if (!state.live) return false;
    set({ pendingRun: id });
    state.live.toggle();
    return true;
  },
  /** Test seam and HMR safety: forget everything. */
  reset() {
    set({ canvas: null, live: null, session: null, pendingRun: null });
  },
};

/** Called by the live view's toggle owner. */
export function useLiveHost(toggle: () => void, enabled: boolean) {
  useEffect(() => (enabled ? publish("live", { toggle }) : undefined), [toggle, enabled]);
}

/** Called by the running live session; also starts a simulation the palette asked for before going live. */
export function useLiveSessionHost(run: (simulationId: string) => void, enabled: boolean, disabledHint?: string) {
  useEffect(() => {
    if (!enabled) return;
    const off = publish("session", { run, disabledHint });
    const pending = state.pendingRun;
    if (pending) {
      set({ pendingRun: null });
      run(pending);
    }
    return off;
  }, [run, enabled, disabledHint]);
}
