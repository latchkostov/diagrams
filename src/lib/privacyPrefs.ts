import { useSyncExternalStore } from "react";
import { safeStorage } from "./storage";
import { PRIVATE_BY_DEFAULT } from "./deployment";

// "New diagrams are private" (File ▸ Privacy ▸): one remembered app-wide setting, off by default (on in a copy
// built with VITE_PRIVATE_BY_DEFAULT=1, ./deployment.ts). While it's on, every diagram you start, open from this
// device, import or paste starts Private. Only a choice that differs from the default is stored.

const KEY = "diagrams.newDiagramsPrivate.v1";
const listeners = new Set<() => void>();
const stored = safeStorage.getItem(KEY);
let value = stored === "1" ? true : stored === "0" ? false : PRIVATE_BY_DEFAULT;

export const newDiagramsPrivate = {
  get: (): boolean => value,
  set(on: boolean): void {
    if (on === value) return;
    value = on;
    if (on === PRIVATE_BY_DEFAULT) safeStorage.removeItem(KEY);
    else safeStorage.setItem(KEY, on ? "1" : "0");
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
