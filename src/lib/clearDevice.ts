import { safeSessionStorage, safeStorage } from "./storage";
import { CLEARED_KEY } from "./diagramIO";

// File ▸ Privacy ▸ Clear everything on this device…: every key Live Diagrams keeps in this browser goes (Your
// diagrams, edits to examples, the shared slot, AI conversations, file destinations, settings), then the app starts
// over. Loaded with the confirmation dialog, never at startup.

/** Every key the app writes starts with this; a copy hosted beside other apps on one origin leaves theirs alone. */
const APP_PREFIX = "diagrams.";

/** Removes the app's keys from local and session storage. Returns how many it removed. */
export function clearAppStorage(): number {
  let removed = 0;
  for (const store of [safeStorage, safeSessionStorage])
    for (const key of store.keys()) if (key.startsWith(APP_PREFIX) && store.removeItem(key)) removed++;
  return removed;
}

/**
 * Clears everything, tells the app's other tabs (they reload, so nothing they hold in memory is written back), and
 * starts this tab afresh at the app's plain address: what was in memory (undo, the clipboard, sign-ins) goes too.
 */
export function clearDevice(): void {
  clearAppStorage();
  safeStorage.setItem(CLEARED_KEY, String(Date.now()));
  safeStorage.removeItem(CLEARED_KEY);
  blockStorageWrites();
  window.location.replace(window.location.pathname);
}

/**
 * Nothing more is written from this page: on the way out, an autosave (pagehide) would otherwise bring the open
 * diagram back. The next page starts with the browser's own storage again.
 */
export function blockStorageWrites(proto: { setItem: Storage["setItem"] } = Storage.prototype): void {
  proto.setItem = () => {};
}
