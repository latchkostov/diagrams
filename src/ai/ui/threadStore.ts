// The AI panel's conversation per diagram, shared by the panel and the WebMCP bridge: an agent's change
// lands in the thread even while the panel is folded or not loaded yet. Backed by thread.ts (this
// browser's storage, capped and validated); the caps hold in memory as well.

import { useCallback, useSyncExternalStore } from "react";
import { capThread, loadThread, saveThread, turnId, type ThreadTurn } from "./thread";

const cache = new Map<string, ThreadTurn[]>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: ThreadTurn[] = [];
/**
 * Threads kept in memory besides the ones on screen (subscribed, never evicted): a diagram visited a while
 * ago reloads from storage. A thread storage refused (full) lives only in memory, so it can go with eviction.
 */
export const MAX_CACHED_THREADS = 4;

/** Most recent last (a Map keeps insertion order); then the oldest unwatched threads go. */
function touch(documentId: string, turns: ThreadTurn[]): void {
  cache.delete(documentId);
  cache.set(documentId, turns);
  for (const id of cache.keys()) {
    if (cache.size <= MAX_CACHED_THREADS) break;
    if (id !== documentId && !listeners.has(id)) cache.delete(id);
  }
}

export const threads = {
  get(documentId: string): ThreadTurn[] {
    const cached = cache.get(documentId);
    if (cached) return cached;
    const turns = loadThread(documentId);
    touch(documentId, turns);
    return turns;
  },
  set(documentId: string, next: ThreadTurn[]): void {
    const capped = capThread(next);
    touch(documentId, capped);
    saveThread(documentId, capped);
    for (const l of listeners.get(documentId) ?? []) l();
  },
  update(documentId: string, fn: (turns: ThreadTurn[]) => ThreadTurn[]): void {
    threads.set(documentId, fn(threads.get(documentId)));
  },
  append(documentId: string, turn: Omit<ThreadTurn, "id" | "at">): void {
    threads.update(documentId, (t) => [...t, { ...turn, id: turnId(), at: Date.now() }]);
  },
  subscribe(documentId: string, l: () => void): () => void {
    let set = listeners.get(documentId);
    if (!set) listeners.set(documentId, (set = new Set()));
    set.add(l);
    return () => {
      set.delete(l);
      if (!set.size && listeners.get(documentId) === set) listeners.delete(documentId);
    };
  },
  /** For tests: how many threads are held in memory. */
  cachedCount: () => cache.size,
};

/** The thread of one diagram (empty while there's no diagram). */
export function useThread(documentId: string | undefined): ThreadTurn[] {
  const subscribe = useCallback(
    (l: () => void) => (documentId ? threads.subscribe(documentId, l) : () => {}),
    [documentId],
  );
  const get = useCallback(() => (documentId ? threads.get(documentId) : EMPTY), [documentId]);
  return useSyncExternalStore(subscribe, get, get);
}
