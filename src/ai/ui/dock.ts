// The AI panel's open state and width: one remembered setting, shared by the rail, the panel and the
// canvas (which folds the inspector to make room). Folded on a first visit; after that, as the person
// left it. Main bundle: keep it tiny.

import { useSyncExternalStore } from "react";

const KEY = "diagrams.ai-dock.v1";
export const DOCK_MIN = 300;
export const DOCK_MAX = 640;
export const DOCK_DEFAULT = 360;
/** The collapsed rail. */
export const RAIL_WIDTH = 40;

export interface DockState {
  open: boolean;
  width: number;
}

export const clampWidth = (w: number, viewport = typeof window === "undefined" ? 1440 : window.innerWidth) =>
  Math.round(Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.floor(viewport * 0.5), w)));

function read(): DockState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DockState> | null;
    return {
      open: raw?.open === true,
      width: typeof raw?.width === "number" && Number.isFinite(raw.width) ? raw.width : DOCK_DEFAULT,
    };
  } catch {
    return { open: false, width: DOCK_DEFAULT };
  }
}

let state: DockState | null = null;
const listeners = new Set<() => void>();
const current = () => (state ??= read());

export const aiDock = {
  get: current,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  set(patch: Partial<DockState>) {
    const next = { ...current(), ...patch };
    if (next.open === current().open && next.width === current().width) return;
    state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked: the setting lasts for this visit.
    }
    for (const l of listeners) l();
  },
  toggle() {
    aiDock.set({ open: !current().open });
  },
};

export function useAiDock(): DockState {
  return useSyncExternalStore(aiDock.subscribe, aiDock.get, aiDock.get);
}

/** Folds the dock to its rail; the keyboard follows to the rail's button when it was in the panel. */
export function collapseDock(): void {
  const panel = document.querySelector('[data-testid="ai-panel"]');
  const hadFocus = !!panel?.contains(document.activeElement);
  aiDock.set({ open: false });
  if (hadFocus)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="ai-rail-open"]')?.focus());
}
