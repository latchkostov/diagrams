import { useSyncExternalStore } from "react";
import { safeStorage } from "./storage";

// "New diagrams are private" (File ▸ Privacy ▸): one remembered app-wide setting, off by default. While
// it's on, every diagram you start, open from this device, import or paste starts Private.

const KEY = "diagrams.newDiagramsPrivate.v1";
const listeners = new Set<() => void>();
let value = safeStorage.getItem(KEY) === "1";

export const newDiagramsPrivate = {
  get: (): boolean => value,
  set(on: boolean): void {
    if (on === value) return;
    value = on;
    if (on) safeStorage.setItem(KEY, "1");
    else safeStorage.removeItem(KEY);
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useNewDiagramsPrivate(): boolean {
  return useSyncExternalStore(newDiagramsPrivate.subscribe, newDiagramsPrivate.get, newDiagramsPrivate.get);
}
