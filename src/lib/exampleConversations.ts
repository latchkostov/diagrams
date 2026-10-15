import { AI_THREAD_PREFIX } from "./aiThreadKey";
import { safeStorage } from "./storage";

// Each tab retains the example conversation it read or edited. Promotion only reads this
// snapshot; it never changes the example's identity, storage or another tab's snapshot.
const snapshots = new Map<string, string | null>();
export const exampleIdentity = (slug: string) => `example:${slug}`;

export function readConversation(identity: string): string | null {
  if (snapshots.has(identity)) return snapshots.get(identity)!;
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
    snapshots.set(identity, raw);
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
        const { after: _after, ...rest } = turn as Record<string, unknown>;
        return rest;
      }),
    });
  } catch {
    return raw;
  }
}

export function saveConversation(identity: string, raw: string | null): boolean {
  const example = identity.startsWith("example:");
  if (example) snapshots.set(identity, raw);
  const key = AI_THREAD_PREFIX + identity;
  // An explicit empty conversation masks any read-only legacy fallback.
  if (raw === null) return example ? safeStorage.setItem(key, '{"turns":[]}') : safeStorage.removeItem(key);
  return safeStorage.setItem(key, raw) || safeStorage.setItem(key, withoutConversationSnapshots(raw));
}
