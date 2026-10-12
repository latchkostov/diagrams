// Where a node is about to land (D3, D13): a faint outline while quick-add is open for the next node, or while a
// stencil is dragged over empty canvas. One small store, so only the outline re-renders as it moves.

export type LandingBox = { x: number; y: number; width: number; height: number };

let current: LandingBox | null = null;
const listeners = new Set<() => void>();

export const landing = {
  get: () => current,
  set(next: LandingBox | null) {
    if (
      next === current ||
      (next &&
        current &&
        next.x === current.x &&
        next.y === current.y &&
        next.width === current.width &&
        next.height === current.height)
    )
      return;
    current = next;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

// The edge a held node (or stencil) would be inserted into (D8), drawn where it ran when the drag began: edges
// step aside from a node over them, so the line it will split is shown through the node.

export type InsertLine = readonly { x: number; y: number }[];

let line: InsertLine | null = null;
const lineListeners = new Set<() => void>();

export const insertLine = {
  get: () => line,
  set(next: InsertLine | null) {
    if (next === line) return;
    line = next;
    for (const l of lineListeners) l();
  },
  subscribe(l: () => void) {
    lineListeners.add(l);
    return () => void lineListeners.delete(l);
  },
};
