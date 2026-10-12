// The one selected node a rail click would add after (decision 4), by name, for the rail's footer. A small
// store, so a selection re-renders the footer alone, never the 150-stencil rail.

let label: string | undefined;
const listeners = new Set<() => void>();

export const railAnchor = {
  get: () => label,
  set(next: string | undefined) {
    if (next === label) return;
    label = next;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
