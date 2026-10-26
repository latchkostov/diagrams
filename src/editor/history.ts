// Undo / redo as a pure, immutable list of snapshots. The canvas hook (useHistory) decides
// *when* to commit (debounced, after drags); this module only manages the stack.

export interface HistoryEntry<T, S = never> {
  /** Structural fingerprint; commits with the same key as the present entry are ignored. */
  key: string;
  value: T;
  /** Optional coalescing tag, e.g. "inspector:node:orders:label". */
  mergeKey?: string;
  /** Commit time (ms) — merges only happen within MERGE_WINDOW_MS of the previous commit. */
  at: number;
  /**
   * What held just before the step began (the canvas keeps the selection here). A commit merged into the
   * step keeps the first one's, so the step's start stays where the edit sequence started.
   */
  start?: S;
}

export interface History<T, S = never> {
  entries: HistoryEntry<T, S>[];
  /** Index of the present entry. */
  index: number;
  /** Undo/redo starts a fresh edit sequence even when the restored tag matches. */
  coalescingBroken?: boolean;
}

export const HISTORY_CAP = 200;
export const MERGE_WINDOW_MS = 1500;

export function createHistory<T, S = never>(key: string, value: T, at = 0): History<T, S> {
  return { entries: [{ key, value, at }], index: 0 };
}

export const present = <T, S>(h: History<T, S>): HistoryEntry<T, S> => h.entries[h.index];
export const canUndo = <T, S>(h: History<T, S>) => h.index > 0;
export const canRedo = <T, S>(h: History<T, S>) => h.index < h.entries.length - 1;

/**
 * Records a new state. Drops the redo branch. Consecutive commits sharing a `mergeKey` within
 * MERGE_WINDOW_MS replace the present entry instead (so typing a label is one undo step). A commit tagged
 * `transaction` (an open creation: a new node, then its name) merges with the present entry of the same tag
 * however long ago that was. Returns the same object when nothing changed.
 */
/** Whether committing `entry` folds it into the present step (same tag, in the merge window) instead of adding one. */
export function merges<T, S>(h: History<T, S>, entry: HistoryEntry<T, S>, transaction?: string): boolean {
  const cur = present(h);
  return (
    cur.key !== entry.key &&
    !h.coalescingBroken &&
    h.index === h.entries.length - 1 &&
    entry.mergeKey !== undefined &&
    cur.mergeKey === entry.mergeKey &&
    h.index > 0 &&
    (entry.at - cur.at <= MERGE_WINDOW_MS || (transaction !== undefined && entry.mergeKey === transaction))
  );
}

export function commit<T, S>(
  h: History<T, S>,
  entry: HistoryEntry<T, S>,
  cap = HISTORY_CAP,
  transaction?: string,
): History<T, S> {
  const cur = present(h);
  if (cur.key === entry.key) return h;
  const merge = merges(h, entry, transaction);
  const base = h.entries.slice(0, merge ? h.index : h.index + 1);
  const entries = [...base, merge && cur.start !== undefined ? { ...entry, start: cur.start } : entry];
  const overflow = Math.max(0, entries.length - cap);
  return { entries: overflow ? entries.slice(overflow) : entries, index: entries.length - 1 - overflow };
}

/** Pending edits keep their normal tag; a document replacement starts and ends a sequence. */
export function commitReplacement<T, S>(
  h: History<T, S>,
  pending: HistoryEntry<T, S>,
  replacement: HistoryEntry<T, S>,
): History<T, S> {
  const flushed = commit(h, pending);
  const committed = commit({ ...flushed, coalescingBroken: true }, replacement);
  return { ...committed, coalescingBroken: true };
}

export function undo<T, S>(h: History<T, S>): History<T, S> {
  return canUndo(h) ? { ...h, index: h.index - 1, coalescingBroken: true } : h;
}

export function redo<T, S>(h: History<T, S>): History<T, S> {
  return canRedo(h) ? { ...h, index: h.index + 1, coalescingBroken: true } : h;
}
