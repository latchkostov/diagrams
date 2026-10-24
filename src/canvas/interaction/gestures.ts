import type { GesturesEvent, GesturesState, GesturesTransition } from "./types";

export const initialGestures = (): GesturesState => ({ active: null, seq: 0 });

/**
 * Pure gesture ownership: G1 start; G2 supersede; G3 move; G4 stale move; G5 drop;
 * G6 cancellation; G7 stale end. K1 steps a sole selected edge; K2 clears on selection change.
 * Document edits and DOM listeners belong to the controller and its pointer adapter, never this machine.
 */
export function gestures(state: GesturesState, event: GesturesEvent): GesturesTransition {
  const unchanged: GesturesTransition = { state, started: null, ended: null };
  switch (event.type) {
    case "gesture.start": {
      const started = { kind: event.kind, preview: event.preview, via: event.via, seq: state.seq + 1 };
      return {
        state: { ...state, active: started, seq: started.seq },
        started,
        ended: state.active ? { ...state.active, reason: "superseded", commit: false } : null,
      };
    }
    case "gesture.move":
      return state.active?.seq === event.seq && state.active.kind === event.preview.kind
        ? { ...unchanged, state: { ...state, active: { ...state.active, preview: event.preview } } }
        : unchanged;
    case "gesture.end":
      return state.active?.seq === event.seq
        ? {
            ...unchanged,
            state: { ...state, active: null },
            ended: { ...state.active, reason: event.reason, commit: event.reason === "drop" },
          }
        : unchanged;
    case "segment.step": {
      if (!event.alone || state.active || event.k < 0) return unchanged;
      return {
        ...unchanged,
        state: {
          ...state,
          keyboardSegment: { edge: event.edge, k: event.k },
        },
      };
    }
    case "segment.reset":
      return { ...unchanged, state: { ...state, keyboardSegment: { edge: event.edge, k: -1 } } };
    case "selection.committed":
      return state.keyboardSegment && state.keyboardSegment.edge !== event.alone
        ? { ...unchanged, state: { ...state, keyboardSegment: undefined } }
        : unchanged;
  }
}

/** A remote deletion cancels only gestures that depended on the deleted items. */
export function gestureTargetRemoved(
  preview: import("./types").GesturePreview,
  nodes: ReadonlySet<string>,
  edges: ReadonlySet<string>,
): boolean {
  switch (preview.kind) {
    case "connect":
      return !nodes.has(preview.from) || (!!preview.over && !nodes.has(preview.over.node));
    case "edge.end":
      return !edges.has(preview.edge) || (!!preview.over && !nodes.has(preview.over.node));
    case "edge.segment":
      return !edges.has(preview.edge);
    case "node.drag":
      return [...preview.origins.keys()].some((id) => !nodes.has(id));
  }
}
