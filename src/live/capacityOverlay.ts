// "Show capacity": whether the bottleneck heat map is on. One app-wide preference (edit and live),
// remembered across visits. A tiny external store so the View menu, the canvas menu's Show ▸, the
// C key and the capacity panel all read and flip the same value.
//
// Opening "Inputs & capacity" shows the heat map for the rest of that live session without
// changing the preference (`showForSession`): closing the panel keeps the colours in view, but
// leaving live view (or reloading) returns to what the user chose. Only an explicit toggle is
// remembered, so one look at the panel never turns the heat map on for every diagram.

import { useSyncExternalStore } from "react";
import { safeStorage } from "../lib/storage";

const KEY = "diagrams.capacityOverlay.v1";
const listeners = new Set<() => void>();
let saved = safeStorage.getItem(KEY) === "1";
let value = saved;

const emit = () => {
  for (const l of listeners) l();
};

export const capacityOverlay = {
  get: (): boolean => value,
  /** An explicit choice (View menu, Show ▸ Capacity, C): shown now and remembered. */
  set(on: boolean): void {
    const changed = on !== value;
    value = on;
    if (on !== saved) {
      saved = on;
      if (on) safeStorage.setItem(KEY, "1");
      else safeStorage.removeItem(KEY);
    }
    if (changed) emit();
  },
  toggle(): void {
    capacityOverlay.set(!value);
  },
  /** On for now (the capacity panel opened), without touching the remembered preference. */
  showForSession(): void {
    if (value) return;
    value = true;
    emit();
  },
  /** Back to the remembered preference (live view ended). */
  endSession(): void {
    if (value === saved) return;
    value = saved;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCapacityOverlay(): boolean {
  return useSyncExternalStore(capacityOverlay.subscribe, capacityOverlay.get, capacityOverlay.get);
}
