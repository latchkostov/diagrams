import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type DiagramMeta } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { canRedo, canUndo, present } from "./history";
import { HistoryController } from "./historyController";
import { selectionOf, snapshotDiagram, withSelection, type FlowSelection } from "./historySelection";
import type { EditorRoom } from "./room";
import { retainRemoteSelection } from "./remoteSnapshot";
import type { CanvasPrivacyState } from "../lib/localOnly";

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
  /**
   * Opens a creation transaction (call before adding the node): the node, its connection and the name typed in
   * its editor are one undo step under `tag`, however long the naming takes, unless another edit comes between.
   */
  begin(tag: string): void;
  /** The editor committed (Enter, Esc, a click away): records what it wrote under `tag`, then closes it. */
  end(tag: string): void;
  /** The open creation transaction's tag, if any (an editor opened on that node joins it). */
  open(): string | undefined;
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

declare global {
  interface Window {
    __historyProbe?: () => { pending: boolean };
  }
}

const clean = (s: CanvasSnapshot): CanvasSnapshot =>
  s.nodes.some((n) => n.dragging || n.resizing)
    ? {
        ...s,
        nodes: s.nodes.map((n) => (n.dragging || n.resizing ? { ...n, dragging: false, resizing: false } : n)),
      }
    : s;

/**
 * Observes canvas state and records undo steps. Every mutation path (menus, inspector, React
 * Flow drags / resizes / deletes, inline editors, reset) is captured without having to call
 * into history: a change is committed once things settle and no drag is in progress. The selection
 * is never a change of its own; Undo and Redo choose it (historySelection.ts) and tell `onStep` what
 * they selected, so keyboard focus can follow.
 */
export function useHistory(
  state: CanvasSnapshot,
  apply: (s: CanvasSnapshot, remote?: boolean) => void,
  onStep?: (direction: "undo" | "redo", selection: FlowSelection) => void,
  room?: EditorRoom,
  privacy?: CanvasPrivacyState,
): HistoryApi & {
  stateKey: string;
  beginGesture(): void;
  endGesture(): void;
  renameTitle(from: string, to: string): void;
} {
  const [ctl] = useState(() => new HistoryController(clean(state), Date.now(), room));
  const [localHistory, setHistory] = useState(ctl.history);
  const history = room ? ctl.history : localHistory;
  const latest = useRef(state);
  const privacyRef = useRef(privacy);
  const gesture = useRef<string | undefined>(undefined);
  const gestureTimer = useRef<number | undefined>(undefined);
  const applyRef = useRef(apply);
  const onStepRef = useRef(onStep);
  const stateKey = useMemo(() => ctl.key(state), [ctl, state]);
  useLayoutEffect(() => {
    latest.current = state;
    privacyRef.current = privacy;
    applyRef.current = apply;
    onStepRef.current = onStep;
  });
  const mergeKey = useRef<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  /** An uncommitted change exists (so Undo is available before the debounce fires). */
  const pending = stateKey !== present(history).key;

  // Read-only completion signal for browser tests; never bundled into the public app.
  useLayoutEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === "1")) return;
    const probe = () => ({ pending: ctl.key(latest.current) !== present(ctl.history).key });
    window.__historyProbe = probe;
    return () => {
      if (window.__historyProbe === probe) delete window.__historyProbe;
    };
  }, [ctl]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const s = latest.current;
    if (s.nodes.some((n) => n.dragging || n.resizing)) return false;
    const changed = ctl.commit(clean(s), gesture.current ?? mergeKey.current, Date.now());
    mergeKey.current = undefined;
    if (changed) setHistory(ctl.history);
    room?.flushRemote();
    return true;
  }, [ctl, room]);

  useLayoutEffect(
    () =>
      room?.connect({
        getSnapshot: () => latest.current,
        flushPending: flush,
        getPrivacy: (next) => ({ ...privacyRef.current, diagram: snapshotDiagram(next) }),
        detached: () => {
          ctl.detachRoom();
          setHistory(ctl.history);
        },
        receive: (next, step) => {
          const retained = step ? withSelection(next, step.selection) : retainRemoteSelection(latest.current, next);
          ctl.receive(retained);
          latest.current = retained;
          setHistory(ctl.history);
          applyRef.current(retained, !step);
          if (step) onStepRef.current?.(step.direction, selectionOf(retained));
        },
      }),
    [room, ctl, flush],
  );

  useLayoutEffect(() => {
    room?.checkPrivacy();
    ctl.observe(state, stateKey);
    // Room commands commit with the rendered edit. Encryption and IDB can finish while the field
    // still holds focus, and navigation cannot cancel an unsent debounce timer.
    if (ctl.collaborative && !state.nodes.some((n) => n.dragging || n.resizing)) {
      ctl.commit(clean(state), gesture.current ?? mergeKey.current, Date.now());
      mergeKey.current = undefined;
      room?.flushRemote();
    }
  }, [ctl, state, stateKey, history, room, privacy]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, DEBOUNCE_MS);
  }, [state.meta, state.nodes, state.edges, flush]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(gestureTimer.current);
    },
    [],
  );

  const go = useCallback(
    (direction: "undo" | "redo") => {
      flush();
      const snapshot = ctl.step(direction, selectionOf(latest.current));
      if (!snapshot) return;
      setHistory(ctl.history);
      // The restored state has the present entry's key, so the next flush is a no-op.
      applyRef.current(snapshot);
      onStepRef.current?.(direction, selectionOf(snapshot));
    },
    [ctl, flush],
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

  const begin = useCallback(
    (tag: string) => {
      hint(tag);
      ctl.begin(tag);
    },
    [hint, ctl],
  );
  const end = useCallback(
    (tag: string) => {
      // After the editor's own update has rendered (it's applied in the same event), so its name is recorded
      // inside the transaction rather than after it closes.
      window.setTimeout(() => {
        if (ctl.openTransaction !== tag) return;
        if (timer.current !== undefined || ctl.key(latest.current) !== present(ctl.history).key) flush();
        ctl.end(tag);
      }, 0);
    },
    [ctl, flush],
  );
  const open = useCallback(() => ctl.openTransaction, [ctl]);
  const beginGesture = useCallback(() => {
    if (!ctl.collaborative) return;
    if (gesture.current && gestureTimer.current === undefined) return;
    flush();
    if (gesture.current) ctl.end(gesture.current);
    window.clearTimeout(gestureTimer.current);
    gestureTimer.current = undefined;
    const tag = room?.newId("gesture");
    if (tag) {
      gesture.current = tag;
      ctl.begin(tag);
    }
  }, [ctl, flush, room]);
  const endGesture = useCallback(() => {
    const tag = gesture.current;
    if (!tag) return;
    window.clearTimeout(gestureTimer.current);
    // Settlement updates in this event must render before the capture closes.
    gestureTimer.current = window.setTimeout(() => {
      gestureTimer.current = undefined;
      if (!tag || gesture.current !== tag) return;
      flush();
      ctl.end(tag);
      gesture.current = undefined;
    }, 0);
  }, [ctl, flush]);

  const replace = useCallback(
    (snapshot: CanvasSnapshot, key?: string, before?: CanvasSnapshot) => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      const next = clean(snapshot);
      // Break coalescing on both sides, even when an adapter reuses its call id.
      ctl.replace(
        clean(before ?? latest.current),
        mergeKey.current,
        next,
        key,
        selectionOf(latest.current),
        Date.now(),
      );
      mergeKey.current = undefined;
      latest.current = next;
      setHistory(ctl.history);
      applyRef.current(next);
    },
    [ctl],
  );

  const renameTitle = useCallback(
    (from: string, to: string) => {
      ctl.renameTitle(from, to);
      const current = latest.current;
      const next = current.meta.title === from ? { ...current, meta: { ...current.meta, title: to } } : current;
      latest.current = next;
      setHistory(ctl.history);
    },
    [ctl],
  );

  const top = useCallback(() => {
    const h = ctl.history;
    if (!ctl.collaborative && h.index === 0) return undefined;
    const cur = present(h);
    return ctl.key(latest.current) === cur.key ? ctl.top() : undefined;
  }, [ctl]);

  return {
    stateKey,
    beginGesture,
    endGesture,
    undo,
    redo,
    renameTitle,
    hint,
    begin,
    end,
    open,
    replace,
    top,
    canUndo: (ctl.collaborative && room ? room.canUndo : canUndo(history)) || pending,
    canRedo: (ctl.collaborative && room ? room.canRedo : canRedo(history)) && !pending,
  };
}
