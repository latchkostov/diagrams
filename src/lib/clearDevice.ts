import { APP_PREFIX, GENERATION_KEY, stopStorageWrites } from "./storage";

// File ▸ Privacy ▸ Clear everything on this device…: every key Live Diagrams keeps in this browser goes (Your
// diagrams, edits to examples, the shared slot, AI conversations, file destinations, settings), then the app starts
// over. It comes with the confirmation dialog, so confirming clears at once: nothing is left to download, cancel or
// fail. Only this tab deletes; the others just stop (./storage.ts):
//   1. this tab stops writing (its autosave on the way out included);
//   2. it deletes every app key, which also frees the space the next step needs when storage is full;
//   3. it writes a new storage generation, and says so on a BroadcastChannel too. Every other tab stops writing as it
//      hears either, or at its next write at the latest (each write checks the generation), drops its own
//      sessionStorage keys and reloads. None of them deletes anything shared, so nothing made after the wipe is lost.
//   4. it drops its own sessionStorage keys, and starts over.

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
 * memory (undo, the clipboard, sign-ins) goes too.
 */
export function clearDevice(): void {
  stopStorageWrites();
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
    removeAppKeys(sessionStorage);
  } catch {
    // Blocked: nothing to drop.
  }
  window.location.replace(window.location.pathname);
}
