import { useEffect } from "react";
import type { DiagramFile } from "../model/types";
import type { LiveController } from "./controller";

// The seam between a running live session and Edit together's shared Live (src/collab/room/liveShare.ts, Watch
// together). The room's code loads with the room, apart from the live view: it finds the session here, and, while
// this person follows someone else's run, paces the run's frames (src/live/simClock.ts) and keeps the editor's own
// edits out of it (the driver's ops bring them, on their ticks). Nothing else changes in the live view.

export interface WatchedSession {
  controller: LiveController;
  /** The diagram as the editor has it now. */
  getDiagram(): DiagramFile;
  /** The canvas's viewport and pane size (its React Flow store): the view a host shares. */
  store: CameraStore;
  /** The canvas's camera (src/canvas/camera): a follower's opt-in "Follow the host's view" goes through it. */
  camera: HostViewCamera;
}

/** What the room asks of the canvas's camera: follow the host's view, and who has the view now. */
export interface HostViewCamera {
  dispatch(event: { type: "host.view"; view: { x: number; y: number; zoom: number } | null }): void;
  readonly state: { owner: string };
  subscribe(listener: () => void): () => void;
}

/** The parts of React Flow's store the room reads and moves: the viewport and the pane's size. */
export interface CameraStore {
  getState(): {
    transform: [number, number, number];
    width: number;
    height: number;
  };
  subscribe(listener: () => void): () => void;
}

export interface Follower {
  /** Wall ms the run advances this frame, given the frame clock's proposal. */
  pace(proposedMs: number): number;
}

let session: WatchedSession | null = null;
const listeners = new Set<() => void>();

export const watchBridge = {
  session: (): WatchedSession | null => session,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Set by the room while this person follows: their frames go at its pace, and their edits wait for the driver. */
  follower: null as Follower | null,
};

/** The live session publishes itself while it's mounted on an editable canvas. */
export function useWatchBridge(watched: WatchedSession | null): void {
  useEffect(() => {
    if (!watched) return;
    session = watched;
    for (const l of listeners) l();
    return () => {
      if (session !== watched) return;
      session = null;
      watchBridge.follower = null;
      for (const l of listeners) l();
    };
  }, [watched]);
}
