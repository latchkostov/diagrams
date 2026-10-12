import { markWorkerUnsupported } from "../../live/liveRenderer";
import { STORAGE_KEY } from "../../harness/settings";
import { readPayload } from "./payload";

// What the exported file's page needs before any of the app's modules run (viewerEntry imports this first).
//
// Storage: the viewer never writes to the browser's storage. Every file:// page shares one localStorage (so a
// viewer's settings or hints would leak into other files), and a sandboxed frame (SharePoint, Confluence)
// throws on any access. The app's modules read and write through `localStorage` and `sessionStorage`, so both
// become in-memory stores for this page: they work, and they're gone when it closes.
//
// Rendering: the live particles draw on the main thread (the renderer's own fallback). A module worker can't
// load from file:// or from a data block, and a blob: worker would need worker-src blob:, which a host's own
// CSP (SharePoint's, say) may refuse; the main-thread path works everywhere the page does.

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

for (const name of ["localStorage", "sessionStorage"] as const) {
  try {
    Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true, enumerable: true });
  } catch {
    // Can't replace it: the app's safeStorage already copes with storage that throws.
  }
}

markWorkerUnsupported();

// The exported theme, through the app's own settings (read once, when the viewer mounts).
const payload = readPayload();
const theme = payload.ok ? payload.options.theme : "light";
localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;
