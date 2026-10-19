import type { LiveUi } from "./context";

/** Inspector lives outside the live provider. Publish the current session without loading its engine on selection. */
let current: LiveUi | null = null;
const listeners = new Set<() => void>();
export const planningHost = {
  get: () => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  publish(ui: LiveUi): () => void {
    current = ui;
    for (const listener of listeners) listener();
    return () => {
      if (current !== ui) return;
      current = null;
      for (const listener of listeners) listener();
    };
  },
};
