// "Show ▸ Dependencies": whether config, secret, identity, telemetry, deploy and depends-on edges are
// drawn. One app-wide preference, on by default and remembered across visits, shared by the View menu,
// the canvas right-click's Show ▸ and Ctrl+K. While they're hidden, nodes show small glyph pips so
// the information is one hover away (docs/research/diagram-semantics.md §2.6).

import { useSyncExternalStore } from "react";
import { safeStorage } from "../lib/storage";

const KEY = "diagrams.showDependencies.v1";
const listeners = new Set<() => void>();
let value = safeStorage.getItem(KEY) !== "0";

export const dependencyVisibility = {
  get: (): boolean => value,
  set(on: boolean): void {
    if (on === value) return;
    value = on;
    if (on) safeStorage.removeItem(KEY);
    else safeStorage.setItem(KEY, "0");
    for (const l of listeners) l();
  },
  toggle(): void {
    dependencyVisibility.set(!value);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useShowDependencies(): boolean {
  return useSyncExternalStore(dependencyVisibility.subscribe, dependencyVisibility.get, dependencyVisibility.get);
}
