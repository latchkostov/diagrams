import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiagramMeta } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { canRedo, canUndo, commit, commitReplacement, createHistory, present } from "./history";
import {
  selectionOf,
  snapshotKey as keyOf,
  stepWithSelection,
  type CanvasHistory,
  type FlowSelection,
} from "./historySelection";

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
  /** Flush the actual current snapshot, commit a replacement, then apply it once. */
  replace(next: CanvasSnapshot, mergeKey?: string, before?: CanvasSnapshot): void;
  /**
   * The tag of the step Undo would reverse next, or undefined when that step is untagged, nothing
   * can be undone, or an edit is still pending (it would be undone first).
   */
  top(): string | undefined;
}

/** Quiet time after the last change before it becomes an undo step. */
const DEBOUNCE_MS = 350;

const clean = (s: CanvasSnapshot): CanvasSnapshot => ({
  ...s,
  nodes: s.nodes.map((n) => (n.dragging || n.resizing ? { ...n, dragging: false, resizing: false } : n)),
});

/**
 * Observes canvas state and records undo steps. Every mutation path (menus, inspector, React
 * Flow drags / resizes / deletes, inline editors, reset) is captured without having to call
 * into history: a change is committed once things settle and no drag is in progress. The selection
 * is never a change of its own; Undo and Redo choose it (historySelection.ts).
 */
export function useHistory(state: CanvasSnapshot, apply: (s: CanvasSnapshot) => void): HistoryApi {
  const [history, setHistory] = useState<CanvasHistory>(() => createHistory(keyOf(state), clean(state), Date.now()));
  const hist = useRef(history);
  const latest = useRef(state);
  const applyRef = useRef(apply);
  const stateKey = useMemo(() => keyOf(state), [state]);
  /** The selection while the canvas matched the present step: where the next step starts from. */
  const settledSelection = useRef<FlowSelection>({ nodes: [], edges: [] });
  useLayoutEffect(() => {
    latest.current = state;
    applyRef.current = apply;
  });
  useLayoutEffect(() => {
    if (stateKey === present(history).key) settledSelection.current = selectionOf(state);
  }, [state, stateKey, history]);
  const mergeKey = useRef<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  /** An uncommitted change exists (so Undo is available before the debounce fires). */
  const pending = stateKey !== present(history).key;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const s = latest.current;
    if (s.nodes.some((n) => n.dragging || n.resizing)) return;
    const next = commit(hist.current, {
      key: keyOf(s),
      value: clean(s),
      mergeKey: mergeKey.current,
      at: Date.now(),
      start: settledSelection.current,
    });
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
    (direction: "undo" | "redo") => {
      flush();
      const step = stepWithSelection(hist.current, direction, selectionOf(latest.current));
      if (!step) return;
      hist.current = step.history;
      setHistory(step.history);
      // The restored state has the present entry's key, so the next flush is a no-op.
      applyRef.current(step.snapshot);
    },
    [flush],
  );

  const undo = useCallback(() => go("undo"), [go]);
  const redo = useCallback(() => go("redo"), [go]);
  const hint = useCallback(
    (key: string | undefined) => {
      // A pending, differently-tagged change gets its own step first.
      if (timer.current !== undefined && mergeKey.current !== key) flush();
      mergeKey.current = key;
    },
    [flush],
  );

  const replace = useCallback((snapshot: CanvasSnapshot, key?: string, before?: CanvasSnapshot) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const current = clean(before ?? latest.current);
    const next = clean(snapshot);
    // Break coalescing on both sides, even when an adapter reuses its call id.
    hist.current = commitReplacement(
      hist.current,
      {
        key: keyOf(current),
        value: current,
        mergeKey: mergeKey.current,
        at: Date.now(),
        start: settledSelection.current,
      },
      { key: keyOf(next), value: next, mergeKey: key, at: Date.now(), start: selectionOf(latest.current) },
    );
    mergeKey.current = undefined;
    latest.current = next;
    setHistory(hist.current);
    applyRef.current(next);
  }, []);

  const top = useCallback(() => {
    const h = hist.current;
    if (h.index === 0) return undefined;
    const cur = present(h);
    return keyOf(latest.current) === cur.key ? cur.mergeKey : undefined;
  }, []);

  return {
    undo,
    redo,
    hint,
    replace,
    top,
    canUndo: canUndo(history) || pending,
    canRedo: canRedo(history) && !pending,
  };
}
