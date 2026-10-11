/** Access storage lazily: even reading the browser's storage getter can throw. */
export function createSafeStorage(resolve: () => Pick<Storage, "getItem" | "setItem" | "removeItem">) {
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
  };
}
export const safeStorage = createSafeStorage(() => localStorage);
export const safeSessionStorage = createSafeStorage(() => sessionStorage);
