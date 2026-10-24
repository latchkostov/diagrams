// Edge label placement. Each label pill goes somewhere on its own route where it covers no node,
// no other label and no group header: the longest straight segment first, nearest its middle.
// When nothing fits it falls back, in order, to wrapping onto 2-3 lines, truncating with an
// ellipsis, and finally a small numbered dot that reveals the text on hover. Deterministic: the
// same geometry always gives the same placement, so labels never jitter between frames.

import { inflate, intersects, segmentHitsRect, type Point, type Rect } from "./rect";
import { SpatialGrid } from "./spatial";

/** Pill metrics in flow px. Labels use a monospace font, so width is exact: chars × charW. */
export const LABEL = {
  charW: 6,
  lineH: 13,
  padX: 7,
  padY: 2,
  border: 1,
  /** Clearance kept between a pill and any node. */
  gap: 4,
  dot: 16,
  /** Fewest characters (ellipsis included) worth showing before falling back to a dot. */
  minChars: 5,
  /** Never draw a single-line pill wider than this many characters; wrap or truncate instead. */
  maxLineChars: 34,
  /** A dependency's glyph inside a pill: 12px icon + 4px gap before the text. */
  glyphLead: 16,
  /** A dependency with no text: a round chip around its 14px glyph. */
  chip: 20,
} as const;

export type LabelMode = "full" | "wrap" | "truncate" | "dot" | "glyph";

export interface LabelPlacement {
  /** Centre of the pill / dot. */
  x: number;
  y: number;
  width: number;
  height: number;
  mode: LabelMode;
  /** Lines to render (one for full / truncate). The full text is always `text`. */
  lines: string[];
  text: string;
  /** 1-based number shown in the dot (mode "dot"). */
  dot?: number;
  /** A dependency: its glyph leads the pill, replaces a dot's number, or is the whole chip ("glyph"). */
  glyph?: boolean;
}

export interface LabelRequest {
  id: string;
  text: string;
  /** The edge's route, source to target. */
  points: readonly Point[];
  /** A dependency: the pill leads with a glyph; with no text it's a glyph chip. */
  glyph?: boolean;
}

export interface LabelEnv {
  nodes: readonly Rect[];
  /** Group header chips. */
  headers?: readonly Rect[];
  /** Every edge's route, to avoid sitting on other lines. */
  routes?: ReadonlyMap<string, readonly Point[]>;
}

export const pillWidth = (chars: number) => chars * LABEL.charW + 2 * (LABEL.padX + LABEL.border) + 1;
export const pillHeight = (lines: number) => lines * LABEL.lineH + 2 * (LABEL.padY + LABEL.border);

/** Greedy word wrap into at most `maxLines`, as narrow as possible. Null when it can't be done. */
export function wrapLines(text: string, maxLines: number): string[] | null {
  // Longer labels cannot fit a three-line pill. Reject before splitting or searching widths:
  // imported text may contain millions of words (including more than Math.max can spread).
  if (text.length > LABEL.maxLineChars * 3 + 2) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const longest = Math.max(...words.map((w) => w.length));
  for (let width = Math.max(longest, Math.ceil(text.length / maxLines)); width < text.length; width++) {
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += " " + w;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return lines.length > 1 ? lines : null;
  }
  return null;
}

interface Candidate {
  p: Point;
  /** Direction of the segment the point lies on (for sliding truncated pills). */
  horizontal: boolean;
}

/** Points along the route to try, best first: longest segment, nearest its middle. */
function candidates(points: readonly Point[]): Candidate[] {
  const segs: { a: Point; b: Point; len: number; start: number }[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0.5) segs.push({ a, b, len, start: total });
    total += len;
  }
  // Stay off the arrowhead and the very start of the line.
  const from = Math.min(10, total / 3);
  const to = Math.max(total - 22, total * 0.66);
  const mid = total / 2;
  const ranked = [...segs].sort((s, t) => {
    // Merge near-equal lengths (bezier samples) and fall back to closeness to the route's middle.
    const d = Math.round(t.len / 4) - Math.round(s.len / 4);
    return d || Math.abs(s.start + s.len / 2 - mid) - Math.abs(t.start + t.len / 2 - mid);
  });
  const out: Candidate[] = [];
  for (const s of ranked) {
    const inset = Math.min(8, s.len / 4);
    const lo = Math.max(s.start + inset, from);
    const hi = Math.min(s.start + s.len - inset, to);
    if (hi < lo) continue;
    const centre = (lo + hi) / 2;
    const horizontal = Math.abs(s.b.x - s.a.x) >= Math.abs(s.b.y - s.a.y);
    const at = (u: number): Point => {
      const k = (u - s.start) / s.len;
      return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k };
    };
    out.push({ p: at(centre), horizontal });
    const step = 10;
    for (let i = 1; i <= 30; i++) {
      const up = centre + i * step,
        down = centre - i * step;
      if (up > hi && down < lo) break;
      if (up <= hi) out.push({ p: at(up), horizontal });
      if (down >= lo) out.push({ p: at(down), horizontal });
    }
  }
  return out;
}

const box = (p: Point, w: number, h: number): Rect => ({ x: p.x - w / 2, y: p.y - h / 2, width: w, height: h });

/** Places every label. Requests are processed shortest route first (they have the fewest options). */
export function placeLabels(reqs: readonly LabelRequest[], env: LabelEnv): Map<string, LabelPlacement> {
  const solid = new SpatialGrid<Rect>(160);
  for (const r of env.nodes) solid.insert(inflate(r, LABEL.gap), r);
  for (const r of env.headers ?? []) solid.insert(inflate(r, 2), r);
  const placed = new SpatialGrid<Rect>(160);
  const lines = new SpatialGrid<{ edge: string; a: Point; b: Point }>(160);
  for (const [edge, pts] of env.routes ?? [])
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      lines.insert(
        { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) },
        { edge, a, b },
      );
    }

  const blocked = (r: Rect) => {
    for (const e of solid.query(r)) if (intersects(r, e.rect)) return true;
    for (const e of placed.query(r)) if (intersects(r, inflate(e.rect, 2))) return true;
    return false;
  };
  const crossings = (r: Rect, id: string) => {
    let n = 0;
    for (const e of lines.query(r)) if (e.item.edge !== id && segmentHitsRect(e.item.a, e.item.b, r)) n++;
    return n;
  };

  const lengthOf = (pts: readonly Point[]) =>
    pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
  const order = reqs
    .filter((r) => (r.text.trim() || r.glyph) && r.points.length >= 2)
    .map((r) => ({ r, len: lengthOf(r.points) }))
    .sort((a, b) => a.len - b.len || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
    .map((x) => x.r);

  const out = new Map<string, LabelPlacement>();
  for (const req of order) {
    const text = req.text.trim();
    const cands = candidates(req.points);
    const lead = req.glyph ? LABEL.glyphLead : 0;
    const commit = (pl: LabelPlacement) => {
      if (req.glyph) pl.glyph = true;
      out.set(req.id, pl);
      placed.insert(box({ x: pl.x, y: pl.y }, pl.width, pl.height), box({ x: pl.x, y: pl.y }, pl.width, pl.height));
    };

    // 0. A dependency with no text: a glyph chip, on the free spot that crosses the fewest lines.
    if (!text) {
      const c = LABEL.chip;
      let chip: { p: Point; cost: number } | null = null;
      for (const cand of cands) {
        const r = box(cand.p, c, c);
        if (blocked(r)) continue;
        const cost = crossings(r, req.id);
        if (!chip || cost < chip.cost) chip = { p: cand.p, cost };
        if (cost === 0) break;
      }
      const spot = chip?.p ?? cands[Math.floor(cands.length / 2)]?.p ?? req.points[0];
      commit({ x: spot.x, y: spot.y, width: c, height: c, mode: "glyph", lines: [], text: "" });
      continue;
    }

    // 1. Full text: one line, then wrapped. Prefer spots that sit on no other line.
    const variants: { mode: LabelMode; lines: string[] }[] = [];
    if (text.length <= LABEL.maxLineChars) variants.push({ mode: "full", lines: [text] });
    for (const n of [2, 3]) {
      const w = wrapLines(text, n);
      if (
        w &&
        Math.max(...w.map((l) => l.length)) <= LABEL.maxLineChars &&
        !variants.some((v) => v.lines.length === w.length)
      )
        variants.push({ mode: "wrap", lines: w });
    }
    let best: { pl: LabelPlacement; cost: number } | null = null;
    variants.forEach((v, vi) => {
      // A full-text spot on no other line already beats anything later in the list.
      if (best && best.cost < 10) return;
      const w = pillWidth(Math.max(...v.lines.map((l) => l.length))) + lead;
      const h = pillHeight(v.lines.length);
      for (const c of cands) {
        const r = box(c.p, w, h);
        if (blocked(r)) continue;
        const x = crossings(r, req.id);
        const cost = x * 10 + vi;
        if (!best || cost < best.cost)
          best = { pl: { x: c.p.x, y: c.p.y, width: w, height: h, mode: v.mode, lines: v.lines, text }, cost };
        if (x === 0) break;
      }
    });
    if (best) {
      commit((best as { pl: LabelPlacement }).pl);
      continue;
    }

    // 2. Truncate: the widest single-line pill that fits anywhere on the route.
    const h1 = pillHeight(1);
    const minW = pillWidth(LABEL.minChars) + lead;
    const fullW = pillWidth(Math.min(text.length, LABEL.maxLineChars)) + lead;
    let trunc: { p: Point; w: number } | null = null;
    for (const c of cands.slice(0, 60)) {
      if (blocked(box(c.p, minW, h1))) continue;
      let lo = minW,
        hi = fullW;
      while (hi - lo > LABEL.charW / 2) {
        const m = (lo + hi) / 2;
        if (blocked(box(c.p, m, h1))) hi = m;
        else lo = m;
      }
      if (!trunc || lo > trunc.w + 0.5) trunc = { p: c.p, w: lo };
      if (lo >= fullW - LABEL.charW) break;
    }
    if (trunc) {
      const chars = Math.floor((trunc.w - lead - pillWidth(0)) / LABEL.charW);
      commit({
        x: trunc.p.x,
        y: trunc.p.y,
        width: pillWidth(chars) + lead,
        height: h1,
        mode: "truncate",
        lines: [text],
        text,
      });
      continue;
    }

    // 3. A numbered dot on the line.
    const d = LABEL.dot;
    const spot = cands.find((c) => !blocked(box(c.p, d, d))) ??
      cands[Math.floor(cands.length / 2)] ?? { p: req.points[0] };
    commit({ x: spot.p.x, y: spot.p.y, width: d, height: d, mode: "dot", lines: [text], text });
  }

  // Number the dots in input order so the numbering is stable.
  let n = 0;
  for (const r of reqs) {
    const pl = out.get(r.id);
    if (pl?.mode === "dot") pl.dot = ++n;
  }
  return out;
}
