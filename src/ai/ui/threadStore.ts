// The AI panel's conversation per diagram, shared by the panel and the WebMCP bridge: an agent's change
// lands in the thread even while the panel is folded or not loaded yet. Backed by thread.ts (this
// browser's storage, capped and validated); the caps hold in memory as well.

import { useCallback, useSyncExternalStore } from "react";
import { capThread, loadThread, saveThread, turnId, type ThreadTurn } from "./thread";

import { cachedTurns, cacheTurns, cachedConversationCount, retainConversation } from "../../lib/exampleConversations";
export { MAX_CACHED_THREADS } from "../../lib/exampleConversations";
const listeners = new Map<string, Set<() => void>>();
const EMPTY: ThreadTurn[] = [];
export const threads = {
  get(documentId: string): ThreadTurn[] {
    const cached = cachedTurns(documentId);
    if (cached) return cached;
    const turns = loadThread(documentId);
    cacheTurns(documentId, turns);
    return turns;
  },
  set(documentId: string, next: ThreadTurn[]): void {
    const capped = capThread(next);
    cacheTurns(documentId, capped);
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
    const release = retainConversation(documentId);
    return () => {
      release();
      set.delete(l);
      if (!set.size && listeners.get(documentId) === set) listeners.delete(documentId);
    };
  },
  /** For tests: how many threads are held in memory. */
  cachedCount: cachedConversationCount,
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
