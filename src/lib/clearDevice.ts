import { APP_PREFIX, GENERATION_KEY, stopStorageWrites } from "./storage";
import { wipeRecoveryDb } from "./recoveryDb";
import { COLLABORATION_LAB } from "./localOnly";

// File ▸ Privacy ▸ Clear everything on this device…: every key Live Diagrams keeps in this browser goes (Your
// diagrams, edits to examples, the shared slot, AI conversations, file destinations, settings), then the app starts
// over. It comes with the confirmation dialog, so confirming clears at once: nothing is left to download, cancel or
// fail. Only this tab deletes; the others just stop (./storage.ts):
//   1. this tab stops writing (its autosave on the way out included);
//   2. it deletes every app key, which also frees the space the next step needs when storage is full;
//   3. it writes a new storage generation, and says so on a BroadcastChannel too. Every other tab stops writing as it
//      hears either, or at its next write at the latest (each write checks the generation), drops its own
//      sessionStorage keys and reloads. None of them deletes anything shared, so nothing made after the wipe is lost.
//   4. it empties the room recovery database (./recoveryDb.ts) in one transaction that also records the new
//      generation, so a late tab's encrypted write can't bring an old room back, and waits for that to commit;
//   5. it drops its own sessionStorage keys (an open room's tab entry with them), and starts over.
// Before step 1 the open room (if any) stops: its writers, its timers and its connections (onClearDevice).

const stops = new Set<() => void>();

/** Something that writes outside the synchronous storage (an open room) stops first: it saves nothing more. */
export function onClearDevice(stop: () => void): () => void {
  stops.add(stop);
  return () => stops.delete(stop);
}

/** Removes the app's keys from one storage, bypassing the write guards (this tab has stopped its own writers). */
export function removeAppKeys(store: Storage): number {
  let removed = 0;
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (key?.startsWith(APP_PREFIX)) {
      store.removeItem(key);
      removed++;
    }
  }
  return removed;
}

/** A new storage generation: random, so it differs from every earlier one. */
export const newGeneration = (): string => `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;

/**
 * Clears everything (after the one confirmation) and starts this tab afresh at the app's plain address: what was in
 * memory (undo, the clipboard, sign-ins) goes too. Resolves just before the page starts over.
 */
export async function clearDevice(): Promise<void> {
  stopStorageWrites();
  for (const stop of [...stops]) {
    try {
      stop();
    } catch {
      // A writer that fails to stop is still refused by every store's generation check.
    }
  }
  const next = newGeneration();
  try {
    removeAppKeys(localStorage);
    localStorage.setItem(GENERATION_KEY, next);
  } catch {
    // Storage blocked: there's nothing stored to clear.
  }
  try {
    const channel = new BroadcastChannel(GENERATION_KEY);
    channel.postMessage(next);
    channel.close();
  } catch {
    // No BroadcastChannel: the storage event and the check before every write still reach the other tabs.
  }
  try {
    await wipeRecoveryDb(next, { collab: COLLABORATION_LAB });
  } catch {
    // IndexedDB unavailable or refused: nothing could be stored there.
  }
  try {
    removeAppKeys(sessionStorage);
  } catch {
    // Blocked: nothing to drop.
  }
  window.location.replace(window.location.pathname);
}
