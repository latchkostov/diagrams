// The marching ants on edges carrying messages, drawn on a canvas instead of animating the SVG's
// `stroke-dashoffset`. A CSS animation restyles and repaints the edge layer on the main thread every
// frame, which keeps input two frames deep while live; drawn here (in the particle worker, or by the
// main-thread fallback) the edges' SVG stays still and only the canvas changes.
//
// The look is the SVG's own: the main thread reads each marching edge's path data, computed stroke
// colour, width, dash pattern and opacity (LiveScene.march) and the canvas strokes the same path
// (Path2D from the `d` attribute) with the same dash, shifted like `lv-march` in live.css: -10 user
// units every 0.9 s. The canvas sits in React Flow's edge layer, above the edges and below the nodes.
// DOM-free, like particleRenderer.ts.

import { context2d, type Surface } from "./particleRenderer";

export interface MarchEdge {
  id: string;
  /** The SVG path data (flow coordinates). */
  d: string;
  /** Computed stroke colour, width (flow units), dash pattern and opacity (the path and its groups). */
  color: string;
  width: number;
  dash: number[];
  opacity: number;
}

export interface MarchView {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
  dpr: number;
}

/** `lv-march`: the dash pattern moves this far (user units) per period. */
export const MARCH_SHIFT = 10;
export const MARCH_PERIOD_MS = 900;

/** The dash offset `phaseMs` into the march (0 under reduced motion, like `animation: none`). */
export function marchOffset(phaseMs: number, reduced: boolean): number {
  if (reduced || !(phaseMs > 0)) return 0;
  return -MARCH_SHIFT * ((phaseMs % MARCH_PERIOD_MS) / MARCH_PERIOD_MS);
}

/** Parses a computed `stroke-dasharray` ("5px, 5px", "none") into numbers. */
export function parseDash(value: string): number[] {
  if (!value || value === "none") return [];
  const out = value
    .split(/[\s,]+/)
    .map((v) => parseFloat(v))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return out.some((n) => n > 0) ? out : [];
}

export class MarchRenderer {
  private ctx: CanvasRenderingContext2D;
  private edges: readonly MarchEdge[] = [];
  private paths = new Map<string, Path2D>();
  private key = "";
  private w = 0;
  private h = 0;
  private dpr = 0;
  private drawnAny = false;
  /** Frames painted (skipped frames don't count). */
  frames = 0;

  constructor(
    private canvas: Surface,
    private makePath: (d: string) => Path2D = (d) => new Path2D(d),
  ) {
    this.ctx = context2d(canvas);
  }

  setEdges(edges: readonly MarchEdge[]): void {
    this.edges = edges;
    const keep = new Set(edges.map((e) => e.d));
    for (const d of this.paths.keys()) if (!keep.has(d)) this.paths.delete(d);
    this.key = "";
  }

  get count(): number {
    return this.edges.length;
  }

  private path(d: string): Path2D {
    let p = this.paths.get(d);
    if (!p) this.paths.set(d, (p = this.makePath(d)));
    return p;
  }

  /** Draws the march `phaseMs` in; skips when nothing would change. */
  draw(v: MarchView, phaseMs: number, reduced: boolean): void {
    if (v.width !== this.w || v.height !== this.h || v.dpr !== this.dpr) {
      this.w = v.width;
      this.h = v.height;
      this.dpr = v.dpr;
      this.canvas.width = Math.max(1, Math.round(v.width * v.dpr));
      this.canvas.height = Math.max(1, Math.round(v.height * v.dpr));
      this.key = "";
      this.drawnAny = true;
    }
    const offset = marchOffset(phaseMs, reduced);
    const key = `${v.x}|${v.y}|${v.zoom}|${offset}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.ctx;
    if (!this.edges.length && !this.drawnAny) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawnAny = this.edges.length > 0;
    if (!this.edges.length) return;
    this.frames++;
    const k = v.zoom * v.dpr;
    ctx.setTransform(k, 0, 0, k, v.x * v.dpr, v.y * v.dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const e of this.edges) {
      if (!(e.opacity > 0) || !(e.width > 0)) continue;
      ctx.globalAlpha = Math.min(1, e.opacity);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.width;
      ctx.setLineDash(e.dash);
      ctx.lineDashOffset = offset;
      ctx.stroke(this.path(e.d));
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
