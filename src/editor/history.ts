// Undo / redo as a pure, immutable list of snapshots. The canvas hook (useHistory) decides
// *when* to commit (debounced, after drags); this module only manages the stack.

export interface HistoryEntry<T> {
  /** Structural fingerprint; commits with the same key as the present entry are ignored. */
  key: string;
  value: T;
  /** Optional coalescing tag, e.g. "inspector:node:orders:label". */
  mergeKey?: string;
  /** Commit time (ms) — merges only happen within MERGE_WINDOW_MS of the previous commit. */
  at: number;
}

export interface History<T> {
  entries: HistoryEntry<T>[];
  /** Index of the present entry. */
  index: number;
  /** Undo/redo starts a fresh edit sequence even when the restored tag matches. */
  coalescingBroken?: boolean;
}

export const HISTORY_CAP = 200;
export const MERGE_WINDOW_MS = 1500;

export function createHistory<T>(key: string, value: T, at = 0): History<T> {
  return { entries: [{ key, value, at }], index: 0 };
}

export const present = <T>(h: History<T>): HistoryEntry<T> => h.entries[h.index];
export const canUndo = <T>(h: History<T>) => h.index > 0;
export const canRedo = <T>(h: History<T>) => h.index < h.entries.length - 1;

/**
 * Records a new state. Drops the redo branch. Consecutive commits sharing a `mergeKey` within
 * MERGE_WINDOW_MS replace the present entry instead (so typing a label is one undo step).
 * Returns the same object when nothing changed.
 */
export function commit<T>(h: History<T>, entry: HistoryEntry<T>, cap = HISTORY_CAP): History<T> {
  const cur = present(h);
  if (cur.key === entry.key) return h;
  const merge =
    !h.coalescingBroken &&
    h.index === h.entries.length - 1 &&
    entry.mergeKey !== undefined &&
    cur.mergeKey === entry.mergeKey &&
    h.index > 0 &&
    entry.at - cur.at <= MERGE_WINDOW_MS;
  const base = h.entries.slice(0, merge ? h.index : h.index + 1);
  const entries = [...base, entry];
  const overflow = Math.max(0, entries.length - cap);
  return { entries: overflow ? entries.slice(overflow) : entries, index: entries.length - 1 - overflow };
}

/** Pending edits keep their normal tag; a document replacement starts and ends a sequence. */
export function commitReplacement<T>(
  h: History<T>,
  pending: HistoryEntry<T>,
  replacement: HistoryEntry<T>,
): History<T> {
  const flushed = commit(h, pending);
  const committed = commit({ ...flushed, coalescingBroken: true }, replacement);
  return { ...committed, coalescingBroken: true };
}

export function undo<T>(h: History<T>): History<T> {
  return canUndo(h) ? { ...h, index: h.index - 1, coalescingBroken: true } : h;
}

export function redo<T>(h: History<T>): History<T> {
  return canRedo(h) ? { ...h, index: h.index + 1, coalescingBroken: true } : h;
}
