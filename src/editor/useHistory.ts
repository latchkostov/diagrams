import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fromFlow, type DiagramMeta } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { canRedo, canUndo, commit, createHistory, present, redo as redoH, undo as undoH } from "./history";

export interface CanvasSnapshot {
  meta: DiagramMeta;
  nodes: FlowNode[];
  edges: DiagramFlowEdge[];
}

export interface HistoryApi {
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** Tag the next commit for coalescing (see EditOptions.merge). Call before mutating. */
  hint(mergeKey: string | undefined): void;
}

/** Quiet time after the last change before it becomes an undo step. */
const DEBOUNCE_MS = 350;

/** What counts as a change: the saved file (positions rounded, selection ignored). */
const keyOf = (s: CanvasSnapshot) => JSON.stringify(fromFlow(s.meta, s.nodes, s.edges));

const clean = (s: CanvasSnapshot): CanvasSnapshot => ({
  ...s,
  nodes: s.nodes.map((n) => (n.dragging || n.resizing ? { ...n, dragging: false, resizing: false } : n)),
});

/**
 * Observes canvas state and records undo steps. Every mutation path (menus, inspector, React
 * Flow drags / resizes / deletes, inline editors, reset) is captured without having to call
 * into history: a change is committed once things settle and no drag is in progress.
 */
export function useHistory(state: CanvasSnapshot, apply: (s: CanvasSnapshot) => void): HistoryApi {
  const [history, setHistory] = useState(() => createHistory(keyOf(state), clean(state), Date.now()));
  const hist = useRef(history);
  const latest = useRef(state);
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    latest.current = state;
    applyRef.current = apply;
  });
  const mergeKey = useRef<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  /** An uncommitted change exists (so Undo is available before the debounce fires). */
  const pending = keyOf(state) !== present(history).key;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const s = latest.current;
    if (s.nodes.some((n) => n.dragging || n.resizing)) return;
    const next = commit(hist.current, { key: keyOf(s), value: clean(s), mergeKey: mergeKey.current, at: Date.now() });
    mergeKey.current = undefined;
    if (next !== hist.current) {
      hist.current = next;
      setHistory(next);
    }
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, DEBOUNCE_MS);
  }, [state.meta, state.nodes, state.edges, flush]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = useCallback(
    (step: typeof undoH) => {
      flush();
      const next = step(hist.current);
      if (next === hist.current) return;
      hist.current = next;
      setHistory(next);
      // The restored state has the present entry's key, so the next flush is a no-op.
      applyRef.current(present(next).value);
    },
    [flush],
  );

  const undo = useCallback(() => go(undoH), [go]);
  const redo = useCallback(() => go(redoH), [go]);
  const hint = useCallback(
    (key: string | undefined) => {
      // A pending, differently-tagged change gets its own step first.
      if (timer.current !== undefined && mergeKey.current !== key) flush();
      mergeKey.current = key;
    },
    [flush],
  );

  return {
    undo,
    redo,
    hint,
    canUndo: canUndo(history) || pending,
    canRedo: canRedo(history) && !pending,
  };
}
