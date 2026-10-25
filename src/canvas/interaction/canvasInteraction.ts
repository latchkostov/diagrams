import type { EditorModeState } from "./mode";

/**
 * The canvas on screen's editor mode, for readers outside the canvas (a tutorial's step runner): its state, its
 * transitions, and the guide a step may give quick-add. Published by the canvas's controller (useInteractionCore) while
 * it's mounted, as the palette host publishes the editor. Reading it never moves focus: only the controller does.
 */
export interface CanvasInteraction {
  readonly mode: EditorModeState;
  subscribeMode(listener: (mode: EditorModeState, previous: EditorModeState) => void): () => void;
  setGuide(guide: { quickAdd?: string } | null): void;
  /** Finish a reconstructed name through the controller's mode and focus policy. */
  dispatch(event: { type: "naming.done"; flowId: string }): void;
}

let current: CanvasInteraction | null = null;
const listeners = new Set<() => void>();

export const canvasInteraction = {
  get: (): CanvasInteraction | null => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** Returns the unpublish (a no-op once another canvas has replaced it). */
  publish(next: CanvasInteraction): () => void {
    current = next;
    listeners.forEach((l) => l());
    return () => {
      if (current !== next) return;
      current = null;
      listeners.forEach((l) => l());
    };
  },
};
