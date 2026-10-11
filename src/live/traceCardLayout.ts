// Where the trace card may sit and how tall it may grow: pure screen geometry (no DOM).

/** The card's top in the pane (trace.css), and the part of it a fit keeps clear: its first rows. */
export const TRACE_CARD_TOP = 64;
export const TRACE_CARD_FOOTPRINT = 220;
/** Room kept between the card and the first node under it. */
const CARD_GAP = 12;

/**
 * How tall the card may grow, in px: down to the first node card under its column (never less than
 * its footprint). 0 when nothing is under it.
 */
export function roomUnderCard(
  s: {
    width: number;
    transform: readonly [number, number, number];
    nodeLookup: ReadonlyMap<
      string,
      {
        type?: string;
        hidden?: boolean;
        data?: unknown;
        measured: { width?: number; height?: number };
        internals: { positionAbsolute: { x: number; y: number } };
      }
    >;
  },
  cardWidth: number,
): number {
  const [tx, ty, z] = s.transform;
  const right = s.width - 16;
  const left = right - cardWidth;
  const floor = TRACE_CARD_TOP + TRACE_CARD_FOOTPRINT;
  let top = Infinity;
  for (const n of s.nodeLookup.values()) {
    // Cards only: a boundary or a zone is a backdrop the card may float over.
    if (n.hidden || n.type === "boundary") continue;
    if (n.type === "annotation" && (n.data as { kind?: string } | undefined)?.kind === "zone") continue;
    const x = n.internals.positionAbsolute.x * z + tx;
    const y = n.internals.positionAbsolute.y * z + ty;
    const w = (n.measured.width ?? 0) * z;
    if (x > right || x + w < left || y < floor - CARD_GAP) continue;
    top = Math.min(top, y);
  }
  return Number.isFinite(top) ? Math.round(Math.max(TRACE_CARD_FOOTPRINT, top - CARD_GAP - TRACE_CARD_TOP)) : 0;
}
