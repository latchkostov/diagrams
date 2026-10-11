// Routes every edge of a diagram in one pass: pick sides, spread ports, find obstacle-avoiding
// orthogonal routes (or bezier / straight curves), nudge shared tracks apart, then place labels.
// The Router instance caches per-edge routes and only re-runs A* for edges whose ends changed or
// whose search area a moved node touched; the global passes (ports, nudging, labels) are cheap.

import type { Side } from "../../model/types";
import { pickSides } from "../edges/routing";
import { placeLabels, type LabelPlacement } from "./labels";
import { nudgeRoutes } from "./nudge";
import { routeOrthogonal, type SoftLine } from "./orthogonal";
import { roundedPath, sampleCubic } from "./path";
import { spreadPorts, type PortEnd } from "./ports";
import { centerOf, inflate, intersects, sideNormal, type Point, type Rect } from "./rect";

export type RouteStyle = "smoothstep" | "bezier" | "straight";

export interface RouteNode {
  id: string;
  rect: Rect;
  /** Extra box that belongs to the node but sits outside it (icon captions). Avoided, not attached to. */
  extra?: Rect;
}

export interface RouteGroup {
  id: string;
  rect: Rect;
  /** The label chip in the group's top-left corner. */
  header: Rect;
}

export interface RouteEdge {
  id: string;
  source: string;
  target: string;
  sourceSide?: Side;
  targetSide?: Side;
  label?: string;
  /** A dependency edge: its label leads with a glyph, or is just a glyph chip when there's no text. */
  glyph?: boolean;
}

export interface RouteInput {
  nodes: readonly RouteNode[];
  groups?: readonly RouteGroup[];
  edges: readonly RouteEdge[];
  direction?: "LR" | "TB";
  style?: RouteStyle;
}

export interface EdgeRoute {
  /** SVG path (one per edge; the live view samples it). */
  path: string;
  /** Polyline of the route (sampled for curves), source port to target port. */
  points: Point[];
  sourceSide: Side;
  targetSide: Side;
  label: LabelPlacement | null;
  /** False when no obstacle-free route existed and a plain elbow was drawn. */
  ok: boolean;
}

export const ROUTE_PAD = 16;
const PORT_SPACING = 14;

/** Estimated group header chip (matches .grp-label: 12px semibold, swatch, padding). */
export function groupHeaderRect(g: Rect, label: string): Rect {
  return { x: g.x + 14, y: g.y + 12, width: Math.round(34 + label.length * 6.9), height: 24 };
}

function selfLoop(sSide: Side, tSide: Side, s: Point, t: Point): Point[] {
  const o = 22;
  const sOut = { x: s.x + sideNormal[sSide].x * o, y: s.y + sideNormal[sSide].y * o };
  const tOut = { x: t.x + sideNormal[tSide].x * o, y: t.y + sideNormal[tSide].y * o };
  const corner = sSide === "left" || sSide === "right" ? { x: sOut.x, y: tOut.y } : { x: tOut.x, y: sOut.y };
  return [s, sOut, corner, tOut, t];
}

function bezier(s: Point, sSide: Side, t: Point, tSide: Side): { path: string; points: Point[] } {
  const d = Math.hypot(t.x - s.x, t.y - s.y);
  const c = Math.max(36, Math.min(220, d * 0.42));
  const p1 = { x: s.x + sideNormal[sSide].x * c, y: s.y + sideNormal[sSide].y * c };
  const p2 = { x: t.x + sideNormal[tSide].x * c, y: t.y + sideNormal[tSide].y * c };
  const f = (v: number) => Math.round(v * 10) / 10;
  return {
    path: `M${f(s.x)},${f(s.y)} C${f(p1.x)},${f(p1.y)} ${f(p2.x)},${f(p2.y)} ${f(t.x)},${f(t.y)}`,
    points: sampleCubic(s, p1, p2, t, 20),
  };
}

const sameLabel = (a: LabelPlacement | null, b: LabelPlacement | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.mode === b.mode &&
    a.dot === b.dot &&
    a.glyph === b.glyph &&
    a.text === b.text &&
    a.lines.join("\n") === b.lines.join("\n"));

interface RawEntry {
  key: string;
  points: Point[];
  ok: boolean;
  region: Rect;
}

export class Router {
  private raw = new Map<string, RawEntry>();
  private prevRects = new Map<string, Rect>();
  private prevGroupsKey = "";
  private prev = new Map<string, EdgeRoute>();
  /** How many edges ran A* in the last call (for tests and the Lab's readout). */
  lastRouted = 0;

  route(input: RouteInput): Map<string, EdgeRoute> {
    const style = input.style ?? "smoothstep";
    const direction = input.direction ?? "LR";
    const rects = new Map(input.nodes.map((n) => [n.id, n.rect]));
    const groups = input.groups ?? [];

    // ---- what moved since last time (invalidates cached A* results near it)
    const dirty: Rect[] = [];
    for (const [id, r] of rects) {
      const p = this.prevRects.get(id);
      if (!p || p.x !== r.x || p.y !== r.y || p.width !== r.width || p.height !== r.height) {
        dirty.push(inflate(r, ROUTE_PAD));
        if (p) dirty.push(inflate(p, ROUTE_PAD));
      }
    }
    for (const [id, p] of this.prevRects) if (!rects.has(id)) dirty.push(inflate(p, ROUTE_PAD));
    const groupsKey = JSON.stringify(groups);
    if (groupsKey !== this.prevGroupsKey) this.raw.clear();
    this.prevGroupsKey = groupsKey;
    this.prevRects = rects;

    // ---- sides
    const edges = input.edges.filter((e) => rects.has(e.source) && rects.has(e.target));
    const sides = new Map<string, { sourceSide: Side; targetSide: Side }>();
    for (const e of edges) {
      const s = rects.get(e.source)!;
      const t = rects.get(e.target)!;
      if (e.source === e.target)
        sides.set(e.id, { sourceSide: e.sourceSide ?? "right", targetSide: e.targetSide ?? "top" });
      else sides.set(e.id, pickSides(s, t, { direction, sourceSide: e.sourceSide, targetSide: e.targetSide }));
    }

    // ---- ports
    const ends: PortEnd[] = [];
    for (const e of edges) {
      const sd = sides.get(e.id)!;
      const sc = centerOf(rects.get(e.source)!);
      const tc = centerOf(rects.get(e.target)!);
      ends.push({ key: `${e.id}\u0000s`, node: e.source, side: sd.sourceSide, toward: tc, order: e.id });
      ends.push({ key: `${e.id}\u0000t`, node: e.target, side: sd.targetSide, toward: sc, order: e.id });
    }
    const ports = spreadPorts(ends, rects, PORT_SPACING);

    // ---- obstacles
    const nodeRects = input.nodes.map((n) => n.rect);
    const obstacles: Rect[] = [
      ...nodeRects,
      ...input.nodes.flatMap((n) => (n.extra ? [n.extra] : [])),
      ...groups.map((g) => g.header),
    ];
    const soft: SoftLine[] = groups.flatMap((g) => [
      { axis: "x" as const, at: g.rect.x, from: g.rect.y, to: g.rect.y + g.rect.height },
      { axis: "x" as const, at: g.rect.x + g.rect.width, from: g.rect.y, to: g.rect.y + g.rect.height },
      { axis: "y" as const, at: g.rect.y, from: g.rect.x, to: g.rect.x + g.rect.width },
      { axis: "y" as const, at: g.rect.y + g.rect.height, from: g.rect.x, to: g.rect.x + g.rect.width },
    ]);

    // ---- per-edge geometry
    const polylines = new Map<string, Point[]>();
    const curves = new Map<string, string>();
    const okMap = new Map<string, boolean>();
    this.lastRouted = 0;
    const seen = new Set<string>();
    for (const e of edges) {
      seen.add(e.id);
      const sd = sides.get(e.id)!;
      const s = ports.get(`${e.id}\u0000s`)!;
      const t = ports.get(`${e.id}\u0000t`)!;
      if (e.source === e.target) {
        polylines.set(e.id, selfLoop(sd.sourceSide, sd.targetSide, s, t));
        okMap.set(e.id, true);
        continue;
      }
      if (style === "straight") {
        polylines.set(e.id, [s, t]);
        okMap.set(e.id, true);
        continue;
      }
      if (style === "bezier") {
        const b = bezier(s, sd.sourceSide, t, sd.targetSide);
        polylines.set(e.id, b.points);
        curves.set(e.id, b.path);
        okMap.set(e.id, true);
        continue;
      }
      const key = `${s.x},${s.y},${sd.sourceSide}|${t.x},${t.y},${sd.targetSide}`;
      const cached = this.raw.get(e.id);
      if (cached && cached.key === key && !dirty.some((d) => intersects(d, cached.region))) {
        polylines.set(e.id, cached.points);
        okMap.set(e.id, cached.ok);
        continue;
      }
      this.lastRouted++;
      const r = routeOrthogonal({
        source: s,
        sourceDir: sideNormal[sd.sourceSide],
        target: t,
        targetDir: sideNormal[sd.targetSide],
        obstacles,
        soft,
        pad: ROUTE_PAD,
      });
      this.raw.set(e.id, { key, points: r.points, ok: r.ok, region: r.region });
      polylines.set(e.id, r.points);
      okMap.set(e.id, r.ok);
    }
    for (const id of this.raw.keys()) if (!seen.has(id)) this.raw.delete(id);

    // ---- nudging (orthogonal only)
    const final = style === "smoothstep" ? nudgeRoutes(polylines, obstacles) : polylines;

    // ---- labels
    const labels = placeLabels(
      edges
        .filter((e) => e.label?.trim() || e.glyph)
        .map((e) => ({ id: e.id, text: e.label ?? "", points: final.get(e.id)!, glyph: e.glyph })),
      {
        nodes: [...nodeRects, ...input.nodes.flatMap((n) => (n.extra ? [n.extra] : []))],
        headers: groups.map((g) => g.header),
        routes: final,
      },
    );

    // ---- assemble, reusing unchanged results so React skips re-rendering those edges
    const out = new Map<string, EdgeRoute>();
    for (const e of edges) {
      const pts = final.get(e.id)!;
      const sd = sides.get(e.id)!;
      const path = curves.get(e.id) ?? (style === "straight" ? roundedPath(pts, 0) : roundedPath(pts, 10));
      const label = labels.get(e.id) ?? null;
      const old = this.prev.get(e.id);
      if (
        old &&
        old.path === path &&
        old.sourceSide === sd.sourceSide &&
        old.targetSide === sd.targetSide &&
        sameLabel(old.label, label)
      )
        out.set(e.id, old);
      else
        out.set(e.id, {
          path,
          points: pts,
          sourceSide: sd.sourceSide,
          targetSide: sd.targetSide,
          label,
          ok: okMap.get(e.id) ?? true,
        });
    }
    this.prev = out;
    return out;
  }
}

/** One-shot convenience for tests and tools. */
export function routeDiagram(input: RouteInput): Map<string, EdgeRoute> {
  return new Router().route(input);
}
