import { bottom, intersect, intersects, right, type Box } from "./placement";

/**
 * The anchored coach: where the instruction card sits. Pure and measured: the card goes beside
 * its target on the side with the most clear room, never over it, and points at it. Like placeTip, it never moves a
 * camera: camera modes are part of what the lessons check.
 */

export type Side = "right" | "left" | "below" | "above";
export interface CardPlace {
  x: number;
  y: number;
  side: Side | null;
  /** Where the pointer sits along the edge facing the target (px from the card's top or left), or null for none. */
  nub: number | null;
  /** A leader from the card to the target when the card couldn't sit right beside it. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}
export interface SheetPlace {
  edge: "top" | "bottom";
  y: number;
  /** The sheet could only fit by covering the target: show it compact (title and actions only). */
  compact: boolean;
}

const GAP = 14;
const MARGIN = 12;
const NUB_INSET = 18;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const overlap = (a: Box, b: Box) => {
  const o = intersect(a, b);
  return o.width * o.height;
};

/** The room on each side of the target inside the viewport, most first. */
function sidesByRoom(target: Box, area: Box, rtl: boolean): Side[] {
  const room: Record<Side, number> = {
    right: right(area) - right(target),
    left: target.x - area.x,
    below: bottom(area) - bottom(target),
    above: target.y - area.y,
  };
  // Beside reads better than above or below at equal room (a line of text runs sideways); logical end first.
  const bias: Record<Side, number> = { right: rtl ? 0 : 24, left: rtl ? 24 : 0, below: 0, above: 0 };
  return (Object.keys(room) as Side[]).sort((a, b) => room[b] + bias[b] - (room[a] + bias[a]));
}

/**
 * A card of `size` beside `target`, inside one of the clear `panes` (the viewport minus chrome). Prefers the side with
 * the most room, centred on the target, and slides along that side before it gives up the side. Returns null when no
 * clear place fits: the caller docks the card instead.
 */
export function placeCard(
  target: Box,
  size: { width: number; height: number },
  panes: readonly Box[],
  area: Box,
  rtl: boolean,
  /** Things better left uncovered (the diagram's nodes): a cost, not a wall. */
  soft: readonly Box[] = [],
): CardPlace | null {
  const order = sidesByRoom(target, area, rtl);
  const cx = target.x + target.width / 2,
    cy = target.y + target.height / 2;
  const sideways = (side: Side) => side === "right" || side === "left";
  const ideal = (side: Side, align: number) => {
    // align: 0 centred on the target, -1 flush with its start (top or left), 1 flush with its end.
    const along = sideways(side)
      ? align === 0
        ? cy - size.height / 2
        : align < 0
          ? target.y - NUB_INSET / 2
          : bottom(target) - size.height + NUB_INSET / 2
      : align === 0
        ? cx - size.width / 2
        : align < 0
          ? target.x - NUB_INSET / 2
          : right(target) - size.width + NUB_INSET / 2;
    return side === "right"
      ? { x: right(target) + GAP, y: along }
      : side === "left"
        ? { x: target.x - GAP - size.width, y: along }
        : side === "below"
          ? { x: along, y: bottom(target) + GAP }
          : { x: along, y: target.y - GAP - size.height };
  };
  const keepOff = { x: target.x - 4, y: target.y - 4, width: target.width + 8, height: target.height + 8 };
  let best: { x: number; y: number; side: Side; score: number } | null = null;
  for (const [rank, side] of order.entries()) {
    for (const align of [0, -1, 1]) {
      const want = ideal(side, align);
      for (const p of panes) {
        const a = { x: p.x + MARGIN, y: p.y + MARGIN, width: p.width - MARGIN * 2, height: p.height - MARGIN * 2 };
        if (size.width > a.width || size.height > a.height) continue;
        const x = clamp(want.x, a.x, right(a) - size.width),
          y = clamp(want.y, a.y, bottom(a) - size.height);
        const card = { x, y, ...size };
        if (intersects(card, keepOff)) continue;
        const drift = Math.abs(x - want.x) + Math.abs(y - want.y);
        const covered = soft.reduce((sum, o) => sum + overlap(card, o), 0);
        const score = drift + rank * 60 + (align ? 12 : 0) + covered / 40;
        if (!best || score < best.score) best = { x, y, side, score };
      }
    }
  }
  if (!best) return null;
  const { x, y, side } = best;
  // Adjacent when the facing edge is still about GAP from the target and the target's centre is along it.
  const along = sideways(side) ? cy - y : cx - x;
  const span = sideways(side) ? size.height : size.width;
  const across =
    side === "right"
      ? x - right(target)
      : side === "left"
        ? target.x - (x + size.width)
        : side === "below"
          ? y - bottom(target)
          : target.y - (y + size.height);
  const adjacent = across >= 0 && across <= GAP * 2.5 && along >= NUB_INSET - 4 && along <= span - NUB_INSET + 4;
  return {
    x,
    y,
    side,
    nub: adjacent ? clamp(along, NUB_INSET, span - NUB_INSET) : null,
    leader: adjacent ? null : leaderBetween({ x, y, ...size }, target),
  };
}

/** From the card's nearest edge point to the target's nearest edge point. */
export function leaderBetween(card: Box, target: Box) {
  const tx = target.x + target.width / 2,
    ty = target.y + target.height / 2;
  const x1 = clamp(tx, card.x, right(card)),
    y1 = clamp(ty, card.y, bottom(card));
  const x2 = clamp(x1, target.x, right(target)),
    y2 = clamp(y1, target.y, bottom(target));
  return { x1, y1, x2, y2 };
}

/** Keep help buttons still while the learner aims, provided the target stays nearby and the chrome remains clear. */
export function keepCard(card: Box, target: Box | null, area: Box, obstacles: readonly Box[]): CardPlace | null {
  if (card.x < area.x || card.y < area.y || right(card) > right(area) || bottom(card) > bottom(area)) return null;
  if ((target && intersects(card, target)) || obstacles.some((o) => intersects(card, o))) return null;
  const leader = target ? leaderBetween(card, target) : null;
  if (leader && Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) > 240) return null;
  return { x: card.x, y: card.y, side: null, nub: null, leader };
}

/**
 * A step with nothing to point at (or whose target is out of view) sits near what it asks you to watch: centred under
 * the visible diagram, or over it, never in a far corner. With no diagram in view, the bottom centre of the canvas.
 */
export function placeHome(
  anchor: Box | null,
  size: { width: number; height: number },
  panes: readonly Box[],
  area: Box,
  soft: readonly Box[] = [],
): CardPlace {
  const fits = (b: Box) =>
    panes.some(
      (p) =>
        b.x >= p.x + MARGIN && b.y >= p.y + MARGIN && right(b) <= right(p) - MARGIN && bottom(b) <= bottom(p) - MARGIN,
    );
  if (anchor) {
    const x = anchor.x + (anchor.width - size.width) / 2;
    for (const y of [bottom(anchor) + GAP * 2, anchor.y - GAP * 2 - size.height]) {
      const card = { x, y, ...size };
      if (fits(card) && !soft.some((o) => intersects(card, o))) return { x, y, side: null, nub: null, leader: null };
    }
  }
  const fit = panes.filter((p) => p.width >= size.width + MARGIN * 2 && p.height >= size.height + MARGIN * 2);
  const centre = anchor ? anchor.x + anchor.width / 2 : area.x + area.width / 2;
  const candidates = (fit.length ? fit : [area]).flatMap((p) => {
    const left = p.x + MARGIN,
      end = right(p) - size.width - MARGIN;
    return [clamp(centre - size.width / 2, left, end), left, end].flatMap((x) =>
      [bottom(p) - size.height - MARGIN, p.y + MARGIN].map((y) => {
        const card = { x, y, ...size };
        const covered = soft.reduce((sum, o) => sum + overlap(card, o), 0);
        return { x, y, score: covered * 10 + Math.abs(x + size.width / 2 - centre) + bottom(area) - bottom(card) };
      }),
    );
  });
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  return { x: best.x, y: best.y, side: null, nub: null, leader: null };
}

/** Phone: a sheet docked to the bottom (or the top when the target is down there), never over the target. */
export function placeSheet(
  target: Box | null,
  height: number,
  area: Box,
  obstacles: readonly Box[],
  compactHeight: number,
): SheetPlace {
  const width = area.width - 16;
  for (const h of [height, compactHeight]) {
    const ys = [bottom(area) - h - 8, area.y + 8, ...obstacles.flatMap((o) => [o.y - h - 8, bottom(o) + 8])];
    for (const y of ys) {
      const slot = { x: area.x + 8, y, width, height: h };
      if (y < area.y + 8 || bottom(slot) > bottom(area) - 8) continue;
      if (target && intersects(slot, target)) continue;
      if (obstacles.some((o) => intersects(slot, o))) continue;
      return { edge: y + h / 2 < area.y + area.height / 2 ? "top" : "bottom", y, compact: h !== height };
    }
  }
  // A full phone dock can occupy both slots. Keep its small controls and the target clear first,
  // then minimise covered chrome. No camera movement or hidden help buttons.
  const ys = [
    area.y + 8,
    bottom(area) - compactHeight - 8,
    ...obstacles.flatMap((o) => [bottom(o) + 8, o.y - compactHeight - 8]),
  ];
  const candidates = ys
    .map((want) => {
      const y = clamp(want, area.y + 8, bottom(area) - compactHeight - 8);
      const slot = { x: area.x + 8, y, width, height: compactHeight };
      const score =
        (target ? overlap(slot, target) * 1_000_000 : 0) +
        obstacles.reduce((sum, o) => sum + (overlap(slot, o) / Math.max(1, o.width * o.height)) * 1000, 0) +
        (bottom(area) - bottom(slot)) / 10;
      return { y, score };
    })
    .sort((a, b) => a.score - b.score);
  const y = candidates[0].y;
  return { edge: y + compactHeight / 2 < area.y + area.height / 2 ? "top" : "bottom", y, compact: true };
}
