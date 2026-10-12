// The Live toggle's breathing dot, drawn on a small canvas in the particle worker. As a CSS
// animation (`lv-breathe`, a box-shadow) it repaints on the main thread every frame, and as a
// compositor animation (an opacity cross-fade) it still holds input a frame deep (docs/BACKLOG.md);
// a worker's OffscreenCanvas reaches the screen without either.
//
// The look is the CSS one: two shadows around the 8 px dot, a ring (spread 3 → 6 px, the dot colour
// at 25% → 8%) over a glow (blur 10 → 14 px), eased in and out over 1.8 s. The canvas sits inside the
// dot, painted before the "Live" label like the shadow was, and leaves the dot itself to CSS (a box
// shadow is never drawn under its box). DOM-free.

import { context2d, type Surface } from "./particleRenderer";

export const BREATHE_MS = 1800;
/** The dot's radius and the canvas's size around it, in CSS px (room for the 14 px glow). */
export const DOT_RADIUS = 4;
export const GLOW_BOX = 64;

const BASE = { spread: 3, alpha: 0.25, blur: 10 };
const PEAK = { spread: 6, alpha: 0.08, blur: 14 };

/** CSS `ease-in-out`: cubic-bezier(0.42, 0, 0.58, 1), solved for x by bisection. */
export function easeInOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0,
    hi = 1,
    t = x;
  for (let i = 0; i < 30; i++) {
    t = (lo + hi) / 2;
    if (bez(t, 0.42, 0.58) < x) lo = t;
    else hi = t;
  }
  return bez(t, 0, 1);
}

/** How far towards the peak (0..1) the breath is at `ms` (keyframes at 0%, 50%, 100%, eased per half). */
export function breath(ms: number): number {
  const t = (((ms % BREATHE_MS) + BREATHE_MS) % BREATHE_MS) / BREATHE_MS;
  return t < 0.5 ? easeInOut(t * 2) : 1 - easeInOut((t - 0.5) * 2);
}

/** The two shadows at breath `b` (0 = the resting style, 1 = the 50% keyframe). */
export function glowAt(b: number): { spread: number; alpha: number; blur: number } {
  return {
    spread: BASE.spread + (PEAK.spread - BASE.spread) * b,
    alpha: BASE.alpha + (PEAK.alpha - BASE.alpha) * b,
    blur: BASE.blur + (PEAK.blur - BASE.blur) * b,
  };
}

/**
 * A computed colour at `alpha`, like `color-mix(in oklab, <color> N%, transparent)`: "rgb(r, g, b)",
 * "#rrggbb", or a CSS Color 4 function without an alpha ("oklab(l a b)" → "oklab(l a b / alpha)").
 */
export function withOpacity(color: string, alpha: number): string {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const fn = /^(oklab|oklch|lab|lch|hsl|hwb|color)\(([^/)]*)\)$/i.exec(color.trim());
  if (fn) return `${fn[1]}(${fn[2].trim()} / ${alpha})`;
  return color;
}

export class GlowRenderer {
  private ctx: CanvasRenderingContext2D;
  private color = "";
  private dpr = 0;
  private lastKey = "";

  constructor(private canvas: Surface) {
    this.ctx = context2d(canvas);
  }

  /** The dot's colour (its computed background) and the device pixel ratio; "" hides the glow. */
  set(color: string, dpr: number): void {
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.canvas.width = this.canvas.height = Math.round(GLOW_BOX * dpr);
    }
    this.color = color;
    this.lastKey = "";
  }

  /** Draws the breath at `ms` (`still`: the resting style, as under reduced motion). */
  draw(ms: number, still: boolean): void {
    const b = still || !this.color ? 0 : breath(ms);
    const key = `${this.color}|${Math.round(b * 400)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const { ctx, dpr } = this;
    const side = this.canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, side, side);
    if (!this.color || !dpr) return;
    const g = glowAt(b);
    const c = side / 2;
    const r = DOT_RADIUS * dpr;
    // The glow: the dot's shape blurred (CSS and canvas both blur with sigma = blur / 2). The shape
    // itself is drawn off the canvas and only its shadow lands here.
    const away = side * 4;
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = g.blur * dpr;
    ctx.shadowOffsetX = away;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(c - away, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // The ring, over the glow (the first CSS shadow paints on top).
    ctx.fillStyle = withOpacity(this.color, g.alpha);
    ctx.beginPath();
    ctx.arc(c, c, r + g.spread * dpr, 0, Math.PI * 2);
    ctx.fill();
    // Nothing under the dot itself: CSS draws it, and shadows never paint beneath their box.
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
}
