import { safeSessionStorage, safeStorage } from "./storage";
import { CLEARED_KEY } from "./diagramIO";

// File ▸ Privacy ▸ Clear everything on this device…: every key Live Diagrams keeps in this browser goes (Your
// diagrams, edits to examples, the shared slot, AI conversations, file destinations, settings), then the app starts
// over. Loaded with the confirmation dialog (and by another tab when it hears of a wipe), never at startup.
//
// Tabs share localStorage but hear of each other's writes late (the storage event), so the order matters:
//   1. this tab stops writing (its autosave on the way out included);
//   2. it tells the others, which stop writing as they hear it (diagramIO's listener, synchronously), then sweep the
//      app's keys themselves, which takes out anything they wrote before they heard, and start over;
//   3. it sweeps, and starts over.
// Each tab sweeps its own sessionStorage too: that's per tab, and a reload keeps it.

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
 * Clears everything (after the one confirmation), with the app's other tabs, and starts this tab afresh at the app's
 * plain address: what was in memory (undo, the clipboard, sign-ins) goes too.
 */
export function clearDevice(): void {
  const set = Storage.prototype.setItem;
  blockStorageWrites();
  try {
    // A new value every time, so every other tab hears it. The sweep below takes it out again.
    set.call(localStorage, CLEARED_KEY, `${Date.now()}.${Math.random()}`);
  } catch {
    // Storage blocked: there's nothing stored to clear either.
  }
  clearAppStorage();
  window.location.replace(window.location.pathname);
}

/** Another tab cleared everything. This one has already stopped writing; it sweeps (late writes too) and reloads. */
export function startOver(): void {
  clearAppStorage();
  window.location.reload();
}

/**
 * Nothing more is written from this page: on the way out, an autosave (pagehide) would otherwise bring the open
 * diagram back. The next page starts with the browser's own storage again.
 */
export function blockStorageWrites(proto: { setItem: Storage["setItem"] } = Storage.prototype): void {
  proto.setItem = () => {};
}
