import { useSyncExternalStore } from "react";
import { workbenchDock } from "../inspector/dockState";

// Whether the Checks card is open, as one tiny store: the canvas right-click, Ctrl+K, the top bar's View menu
// and the count under the title all open it, and the canvas shows it. `available` is false where checks don't
// apply (live view, presenting, embeds, the gallery): opening is then a no-op and the View menu greys it out.

let open = false;
let available = false;
/** What had focus when the card opened: focus goes back there when it closes. */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const checksPanel = {
  isOpen: () => open && available,
  isAvailable: () => available,
  open() {
    if (!available) return;
    workbenchDock.show("checks");
    if (open) return;
    open = true;
    const at = typeof document === "undefined" ? null : document.activeElement;
    opener = at instanceof HTMLElement && at !== document.body ? at : null;
    emit();
  },
  /** What had focus when the card opened, while it's still on the page. */
  opener: (): HTMLElement | null => (opener?.isConnected ? opener : null),
  close() {
    if (!open) return;
    open = false;
    if (workbenchDock.get().value === "checks") workbenchDock.back();
    emit();
  },
  toggle() {
    if (open) checksPanel.close();
    else checksPanel.open();
  },
  /** The canvas says where checks apply. Leaving (live, presenting, another view) closes the card. */
  setAvailable(on: boolean) {
    if (on === available) return;
    available = on;
    if (!on) {
      open = false;
      if (workbenchDock.get().value === "checks") workbenchDock.back();
    }
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const snapshot = () => (available ? (open ? 2 : 1) : 0);

/** `{ open, available }`, re-rendering when either changes. */
export function useChecksPanel(): { open: boolean; available: boolean } {
  const s = useSyncExternalStore(checksPanel.subscribe, snapshot, snapshot);
  return { open: s === 2, available: s > 0 };
}
