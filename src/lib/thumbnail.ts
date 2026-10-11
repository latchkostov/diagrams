import type { DiagramFile } from "../model/types";
import { estimateCardSize } from "../canvas/nodes/size";
import { getStencil } from "../stencils/registry";

/**
 * A diagram's thumbnail as data, not pixels: node boxes (with their stencil accent), boundary boxes
 * and edges as centre-to-centre lines, normalised into a small viewBox. It's cheap to compute on
 * every autosave, small enough to keep in the library index (well under a kilobyte), and
 * `DiagramThumbnail` renders it as a crisp inline SVG at any size.
 */
export interface Thumb {
  /** viewBox size; the longer side is `THUMB_SIZE`. */
  w: number;
  h: number;
  /** [x, y, width, height, accent] */
  nodes: [number, number, number, number, string][];
  /** [x, y, width, height] */
  groups: [number, number, number, number][];
  /** Node indices (into `nodes`). */
  edges: [number, number][];
}

export const THUMB_SIZE = 100;
/** Enough to read the shape of a big diagram; keeps every index entry small. */
const MAX_NODES = 48;
const MAX_EDGES = 72;
const MAX_GROUPS = 12;

const round = (n: number) => Math.round(n * 10) / 10;
const HEX = /^#[0-9a-f]{3,8}$/i;

export function diagramThumb(d: Pick<DiagramFile, "nodes" | "edges" | "groups">): Thumb {
  const nodes = d.nodes.slice(0, MAX_NODES);
  const boxes = nodes.map((n) => {
    const size = estimateCardSize(n.label ?? "", n.sublabel);
    return { id: n.id, x: n.x, y: n.y, w: size.width, h: size.height, accent: getStencil(n.stencil).accent };
  });
  const groups = (d.groups ?? []).slice(0, MAX_GROUPS);
  const xs = [...boxes.map((b) => b.x), ...groups.map((g) => g.x)];
  const ys = [...boxes.map((b) => b.y), ...groups.map((g) => g.y)];
  const xe = [...boxes.map((b) => b.x + b.w), ...groups.map((g) => g.x + g.width)];
  const ye = [...boxes.map((b) => b.y + b.h), ...groups.map((g) => g.y + g.height)];
  if (!xs.length) return { w: THUMB_SIZE, h: THUMB_SIZE * 0.6, nodes: [], groups: [], edges: [] };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xe) - minX);
  const spanY = Math.max(1, Math.max(...ye) - minY);
  const k = THUMB_SIZE / Math.max(spanX, spanY);
  const index = new Map(boxes.map((b, i) => [b.id, i]));
  const edges: [number, number][] = [];
  for (const e of d.edges) {
    if (edges.length >= MAX_EDGES) break;
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) edges.push([a, b]);
  }
  return {
    w: round(spanX * k),
    h: round(spanY * k),
    nodes: boxes.map((b) => [
      round((b.x - minX) * k),
      round((b.y - minY) * k),
      round(b.w * k),
      round(b.h * k),
      b.accent,
    ]),
    groups: groups.map((g) => [
      round((g.x - minX) * k),
      round((g.y - minY) * k),
      round(g.width * k),
      round(g.height * k),
    ]),
    edges,
  };
}

/** Stored thumbnails come back from localStorage: anything malformed reads as missing. */
export function isThumb(v: unknown): v is Thumb {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<Thumb>;
  const nums = (a: unknown, n: number) =>
    Array.isArray(a) && a.length >= n && a.slice(0, n).every((x) => typeof x === "number" && Number.isFinite(x));
  return (
    typeof t.w === "number" &&
    typeof t.h === "number" &&
    Array.isArray(t.nodes) &&
    t.nodes.every((n) => nums(n, 4) && typeof n[4] === "string" && HEX.test(n[4])) &&
    Array.isArray(t.groups) &&
    t.groups.every((g) => nums(g, 4)) &&
    Array.isArray(t.edges) &&
    t.edges.every((e) => nums(e, 2))
  );
}
