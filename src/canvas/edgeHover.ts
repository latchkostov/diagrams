// Insert on drop (D8): a node dragged (or a stencil dropped from the rail) over an edge splits it, but only
// after a deliberate hover. The edge under the pointer lights up once the pointer has stayed on it for
// INSERT_HOVER_MS, so a drag that only passes over an edge never splits it. Ctrl/Cmd held: no insert.
//
// Edges route around nodes, so the moment a dragged node covers an edge, the edge steps aside. What the
// pointer is over is therefore read from the routes as they were when the drag began.

export const INSERT_HOVER_MS = 300;
/** Set on the edge's drawing (its `.fe` group) while a drop would split it; the CSS lights it up. */
const LIT = "data-insert";

type Point = { x: number; y: number };

/** Distance from `p` to the segment a–b. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The edge whose line passes nearest `p`, within `tolerance` (all in flow coordinates), if any. */
export function nearestEdge(
  lines: Iterable<{ id: string; points: readonly Point[] }>,
  p: Point,
  tolerance: number,
): string | null {
  let best: string | null = null;
  let bestD = tolerance;
  for (const { id, points } of lines)
    for (let i = 1; i < points.length; i++) {
      const d = toSegment(p, points[i - 1], points[i]);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
  return best;
}

export interface EdgeHover {
  /** The pointer moved (client coords); `free`: Ctrl/Cmd held, so nothing lights up. */
  at(x: number, y: number, free?: boolean): void;
  /** The edge lit up now (a drop would split it), if any. */
  lit(): string | null;
  /** Clears the highlight and any pending one. */
  clear(): void;
}

/**
 * `pick` names the edge under a client point; `drawing` finds an edge's drawn group (to light it up).
 */
export function edgeHover(
  pick: (x: number, y: number) => string | null,
  drawing: (edgeId: string) => Element | null,
  delay = INSERT_HOVER_MS,
  /** Told the edge lit up, or null when none is. */
  onLit?: (edgeId: string | null) => void,
): EdgeHover {
  let under: string | null = null;
  let litEl: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unlight = () => {
    clearTimeout(timer);
    timer = undefined;
    if (litEl) onLit?.(null);
    litEl?.removeAttribute(LIT);
    litEl = null;
  };
  return {
    at(x, y, free = false) {
      const next = free ? null : pick(x, y);
      if (next === under) return;
      unlight();
      under = next;
      if (!next) return;
      timer = setTimeout(() => {
        const el = under === next ? drawing(next) : null;
        if (!el) return;
        litEl = el;
        el.setAttribute(LIT, "1");
        onLit?.(next);
      }, delay);
    },
    lit: () => (litEl ? under : null),
    clear() {
      unlight();
      under = null;
    },
  };
}
