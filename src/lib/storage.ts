type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;

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
      try {
        resolve().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    removeItem(key: string): boolean {
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
