type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;

/** Off in an embed: it reads the person's preferences (the theme) but never writes them (stopStorageWrites). */
let writes = true;

/**
 * An embed (`?embed`, the link's and the host-supplied one) keeps what it changes (a host's theme, a folded panel) in
 * memory for its lifetime: it writes nothing to this site's storage. Writes report success, so nothing warns.
 */
export function stopStorageWrites(): void {
  writes = false;
}

/** Access storage lazily: even reading the browser's storage getter can throw. */
export function createSafeStorage(resolve: () => StorageLike) {
  return {
    getItem(key: string): string | null {
      try {
        return resolve().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): boolean {
      if (!writes) return true;
      try {
        resolve().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeItem(key: string): boolean {
      if (!writes) return true;
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
export const safeStorage = createSafeStorage(() => localStorage);
export const safeSessionStorage = createSafeStorage(() => sessionStorage);
