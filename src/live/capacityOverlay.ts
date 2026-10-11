// "Show capacity": whether the bottleneck heat map is on. One app-wide preference (edit and live),
// remembered across visits. A tiny external store so the View menu, the canvas menu, the C key and
// the capacity panel all read and flip the same value.

import { useSyncExternalStore } from "react";
import { safeStorage } from "../lib/storage";

const KEY = "diagrams.capacityOverlay.v1";
const listeners = new Set<() => void>();
let value = safeStorage.getItem(KEY) === "1";

export const capacityOverlay = {
  get: (): boolean => value,
  set(on: boolean): void {
    if (on === value) return;
    value = on;
    if (on) safeStorage.setItem(KEY, "1");
    else safeStorage.removeItem(KEY);
    for (const l of listeners) l();
  },
  toggle(): void {
    capacityOverlay.set(!value);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCapacityOverlay(): boolean {
  return useSyncExternalStore(capacityOverlay.subscribe, capacityOverlay.get, capacityOverlay.get);
}
