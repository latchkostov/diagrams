// The exported file's first module: it runs before any of the app's modules is even evaluated (viewerEntry
// imports it first, and it imports nothing), because some of them read the browser's storage as they load
// (dependencyVisibility, the settings, the recent stencils).
//
// The viewer never touches the browser's storage. Every file:// page shares one localStorage (so a viewer's
// settings or hints would leak into other files, and the reader's own preferences into the viewer), and a
// sandboxed frame (SharePoint, Confluence) throws on any access. So `localStorage` and `sessionStorage` become
// in-memory stores for this page: the app's modules work as usual, and everything is gone when it closes.

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  clear() {
    this.#items.clear();
  }
  getItem(key: string) {
    return this.#items.get(String(key)) ?? null;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#items.delete(String(key));
  }
  setItem(key: string, value: string) {
    this.#items.set(String(key), String(value));
  }
}

/** The names this module replaces; the template test checks nothing names them earlier in the script. */
export const ISOLATED_STORES = ["localStorage", "sessionStorage"] as const;

for (const name of ISOLATED_STORES) {
  try {
    Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true, enumerable: true });
  } catch {
    // Can't replace it: the app's safeStorage already copes with storage that throws.
  }
}
