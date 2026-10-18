type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;

// Every key the app keeps goes through here, so two rules hold for all of them:
//
// - An embed (`?embed`, the link's and the host-supplied one) reads the person's preferences but writes nothing:
//   what it changes (a host's theme, a folded panel) lasts as long as the frame (stopStorageWrites).
// - In the app (startStorageLifecycle, called once by main.tsx; never by the exported HTML viewer, whose storage is
//   its own memory), Clear everything on this device (./clearDevice.ts) gives the browser's storage a new generation.
//   A tab that loaded before it writes nothing more: every write to localStorage checks the generation first, and a
//   tab that finds it changed (or hears so) stops, drops its own sessionStorage keys and reloads (startOver). Only the
//   tab where the person confirmed ever deletes shared storage, so work made after a wipe is never deleted by a late
//   tab.

/** The browser's storage generation: a new random value each time everything is cleared. */
export const GENERATION_KEY = "diagrams.generation";
/** Every key the app writes starts with this; a copy hosted beside other apps on one origin leaves theirs alone. */
export const APP_PREFIX = "diagrams.";

const generation = () => {
  try {
    return localStorage.getItem(GENERATION_KEY);
  } catch {
    return null;
  }
};
/** The generation this page loaded with; undefined outside the app's lifecycle (tests, the exported viewer). */
let born: string | null | undefined;
/** Off in an embed, after Clear everything here, and in a tab from an earlier generation. */
let writes = true;

/** Stops this page's writes to storage. Writes then report success, so nothing warns. */
export function stopStorageWrites(): void {
  writes = false;
}

/** Everything was cleared in another tab: write nothing more, drop this tab's own session keys, and start over. */
function startOver(): void {
  if (!writes) return; // an embed (it writes nothing anyway), or already starting over
  writes = false;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(APP_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing to drop.
  }
  window.location.reload();
}

/** Whether this page may write to localStorage now: not stopped, and still in the generation it loaded with. */
function mayWrite(): boolean {
  if (writes && born !== undefined && generation() !== born) startOver();
  return writes;
}

/** The generation this page loaded with: undefined outside the app's lifecycle (tests, the exported viewer). */
export const storageGeneration = (): string | null | undefined => born;

/**
 * Whether this page may still write anything shared between tabs (localStorage, IndexedDB): the same check every
 * localStorage write makes. A tab that finds the generation changed starts over.
 */
export function sharedWritesAllowed(): boolean {
  return mayWrite();
}

/** The app's page joins the storage generation it loaded with, and hears when another tab clears everything. */
export function startStorageLifecycle(): void {
  if (born !== undefined) return;
  born = generation();
  window.addEventListener("storage", (e) => e.key === GENERATION_KEY && startOver());
  try {
    new BroadcastChannel(GENERATION_KEY).onmessage = startOver;
  } catch {
    // No BroadcastChannel: the storage event, and the check before every write, still hold.
  }
}

/** Access storage lazily: even reading the browser's storage getter can throw. */
export function createSafeStorage(resolve: () => StorageLike, shared = false) {
  const allowed = () => (shared ? mayWrite() : writes);
  return {
    getItem(key: string): string | null {
      try {
        return resolve().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): boolean {
      if (!allowed()) return true;
      try {
        resolve().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeItem(key: string): boolean {
      if (!allowed()) return true;
      try {
        resolve().removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
    /** Every stored key; empty when storage is blocked or can't be listed. */
    keys(): string[] {
      try {
        const s = resolve();
        if (typeof s.length !== "number" || typeof s.key !== "function") return [];
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
export const safeStorage = createSafeStorage(() => localStorage, true);
export const safeSessionStorage = createSafeStorage(() => sessionStorage);
