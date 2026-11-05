import { useMemo } from "react";
import type { CanvasSnapshot, useHistory as useEditingHistory } from "../../editor/useHistory";
export function createReadOnlyHistory(apply: (snapshot: CanvasSnapshot) => void): ReturnType<typeof useEditingHistory> {
  const none = () => {};
  return {
    stateKey: "",
    beginGesture: none,
    endGesture: none,
    renameTitle: none,
    undo: none,
    redo: none,
    canUndo: false,
    canRedo: false,
    hint: none,
    begin: none,
    end: none,
    open: () => undefined,
    top: () => undefined,
    replace: (next) => apply(next),
  };
}
/** A file has no document edits, autosave, collaborative room or Undo to record. */
export function useHistory(_state: CanvasSnapshot, apply: (snapshot: CanvasSnapshot) => void) {
  return useMemo(() => createReadOnlyHistory(apply), [apply]);
}
