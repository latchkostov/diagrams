import { useEffect } from "react";
import type { EditorApi } from "../editor/types";
import type { LiveState } from "../live/controller";

/**
 * What the command palette can act on. The palette is mounted by the app, outside the canvas, so
 * the editable canvas and the live view publish themselves here with one hook call each:
 *
 *   useCanvasHost(editor, { live, enabled: !readOnly });   // CanvasView (./canvasHost, needs React Flow)
 *   useLiveHost(toggle, goLive, enabled);                  // LiveView (the Live toggle)
 *   useLiveSessionHost(selectSimulation, enabled, hint, getState); // LiveView's running session
 *
 * Each hook unpublishes on unmount, so the palette only offers what is on screen.
 */

export interface CanvasHost {
  editor: EditorApi;
  /** Privacy provenance, for the one decision in src/lib/localOnly.ts (never read these directly). */
  localOnly?: boolean;
  private?: boolean;
  onDevice?: boolean;
  /** "Allow the on-device model" for this private diagram. */
  allowOnDevice?(on: boolean): void;
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
  /** Turns live view on; already on (its session still loading, say), nothing changes. */
  goLive(): void;
}

export interface SessionHost {
  /** Replays a saved simulation in the running session. */
  run(simulationId: string): void;
  disabledHint?: string;
  /** What's running now (the AI panel's Explain, in live view). */
  state?(): LiveState;
}

interface HostState {
  canvas: CanvasHost | null;
  live: LiveHost | null;
  session: SessionHost | null;
  /** A simulation to start as soon as the live session is up. */
  pendingRun: { documentId: string | undefined; simulationId: string } | null;
}

let state: HostState = { canvas: null, live: null, session: null, pendingRun: null };
const listeners = new Set<() => void>();

function set(patch: Partial<HostState>) {
  state = { ...state, ...patch };
  drainRun();
  for (const l of listeners) l();
}

function drainRun() {
  const request = state.pendingRun;
  if (!request || state.canvas?.documentId !== request.documentId || !state.live) return;
  if (!state.session) {
    state.live.goLive();
    return;
  }
  const session = state.session;
  state = { ...state, pendingRun: null };
  if (!session.disabledHint) session.run(request.simulationId);
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
  runSimulation(id: string, documentId = state.canvas?.documentId): boolean {
    if (state.canvas?.documentId === documentId && state.session?.disabledHint) return false;
    if (!state.live && documentId === undefined) return false;
    set({ pendingRun: { documentId, simulationId: id } });
    return true;
  },
  cancelRun() {
    if (state.pendingRun) set({ pendingRun: null });
  },
  /** Test seam and HMR safety: forget everything. */
  reset() {
    set({ canvas: null, live: null, session: null, pendingRun: null });
  },
};

/** Called by the live view's toggle owner. */
export function useLiveHost(toggle: () => void, goLive: () => void, enabled: boolean) {
  useEffect(() => (enabled ? publish("live", { toggle, goLive }) : undefined), [toggle, goLive, enabled]);
}

/** Called by the running live session; also starts a simulation the palette asked for before going live. */
export function useLiveSessionHost(
  run: (simulationId: string) => void,
  enabled: boolean,
  disabledHint?: string,
  getState?: () => LiveState,
) {
  useEffect(() => {
    if (!enabled) return;
    const off = publish("session", { run, disabledHint, ...(getState ? { state: getState } : {}) });
    return off;
  }, [run, enabled, disabledHint, getState]);
}
