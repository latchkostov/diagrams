import { TUTORIAL_SLUG } from "../tutorials/sandbox";
import { AI_THREAD_PREFIX } from "./aiThreadKey";
import { safeStorage } from "./storage";

import type { ThreadTurn } from "../ai/ui/thread";

// One LRU owns both parsed threads and the serialized snapshot used by promotion.
export const MAX_CACHED_THREADS = 4;
const cache = new Map<string, { raw?: string | null; turns?: ThreadTurn[] }>();
const pins = new Map<string, number>();
function trim(keep?: string) {
  for (const id of cache.keys()) {
    if (cache.size <= MAX_CACHED_THREADS) break;
    if (id !== keep && !pins.has(id)) cache.delete(id);
  }
}
function touch(identity: string) {
  const entry = cache.get(identity) ?? {};
  cache.delete(identity);
  cache.set(identity, entry);
  trim(identity);
  return entry;
}
export function retainConversation(identity: string): () => void {
  pins.set(identity, (pins.get(identity) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = pins.get(identity) ?? 0;
    if (count <= 1) pins.delete(identity);
    else pins.set(identity, count - 1);
    trim();
  };
}
export const cachedConversationCount = () => cache.size;
export const cachedTurns = (identity: string) => cache.get(identity)?.turns;
export function cacheTurns(identity: string, turns: ThreadTurn[]) {
  touch(identity).turns = turns;
}
export const exampleIdentity = (slug: string) => `example:${slug}`;

export function readConversation(identity: string): string | null {
  const cached = cache.get(identity);
  if (cached && "raw" in cached) return touch(identity).raw!;
  if (identity === exampleIdentity(TUTORIAL_SLUG)) return null;
  let raw = safeStorage.getItem(AI_THREAD_PREFIX + identity);
  if (identity.startsWith("example:")) {
    // Older versions used a generation key. Read it only as a fallback; never migrate it.
    if (raw === null) {
      try {
        const previous: unknown = JSON.parse(
          safeStorage.getItem(`diagrams.example-session.v1:${identity.slice(8)}`) ?? "null",
        );
        if (typeof previous === "string" && previous.startsWith(identity + ":"))
          raw = safeStorage.getItem(AI_THREAD_PREFIX + previous);
      } catch {
        /* Malformed legacy marker. */
      }
    }
    touch(identity).raw = raw;
  }
  return raw;
}

/** The same snapshot-dropping fallback for normal saves and promotion. */
export function withoutConversationSnapshots(raw: string): string {
  try {
    const value = JSON.parse(raw) as { turns?: unknown } | null;
    if (!Array.isArray(value?.turns)) return raw;
    return JSON.stringify({
      turns: value.turns.map((turn: unknown) => {
        if (!turn || typeof turn !== "object") return turn;
        const { after: _after, before: _before, ...rest } = turn as Record<string, unknown>;
        return rest;
      }),
    });
  } catch {
    return raw;
  }
}

export function saveConversation(identity: string, raw: string | null): boolean {
  const example = identity.startsWith("example:");
  if (example) touch(identity).raw = raw;
  if (identity === exampleIdentity(TUTORIAL_SLUG)) return true;
  const key = AI_THREAD_PREFIX + identity;
  // An explicit empty conversation masks any read-only legacy fallback.
  if (raw === null) return example ? safeStorage.setItem(key, '{"turns":[]}') : safeStorage.removeItem(key);
  return safeStorage.setItem(key, raw) || safeStorage.setItem(key, withoutConversationSnapshots(raw));
}
