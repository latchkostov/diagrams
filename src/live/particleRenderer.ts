// Draws every particle, trail, arrival pulse and failure flash onto one <canvas>, imperatively,
// once per animation frame. No React here: the live view calls `draw(snapshot)` from rAF.
//
// Budget (~1,500 particles at 60 fps): per particle it's one Map lookup, one interpolation and one
// drawImage of a pre-rendered glow sprite. Trails are batched into one stroke per colour.

import type { Particle, ParticleKind, SimSnapshot } from "../sim/types";
import { PathCache, pointOnSamples, sampleIndex, type PathLike, type PathSamples } from "./pathSampler";
import { nearestOnBox, placeTraceLabels, traceLabelInk, type Box, type PlacedLabel } from "./traceLabels";

/** Theme colours the canvas can't read from CSS by itself (from tokens.css, see `readParticleTokens`). */
export interface ParticleTokens {
  /** Centre of a particle head (--particle-core). */
  core: string;
  /** Glow strength 0..1 (--particle-glow-opacity) and size in px (--particle-glow-blur). */
  glowOpacity: number;
  glowBlur: number;
  /** Retry particles (--status-paused), dead letters (--live-dlq), failure flashes (--status-down). */
  retry: string;
  dlq: string;
  fail: string;
}

export const DEFAULT_TOKENS: ParticleTokens = {
  core: "#ffffff",
  glowOpacity: 0.5,
  glowBlur: 6,
  retry: "#d99000",
  dlq: "#d1393f",
  fail: "#d1393f",
};

/** Reads the particle tokens off the document (call after the theme attribute changed). */
export function readParticleTokens(el: Element = document.documentElement): ParticleTokens {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const n = (name: string, fallback: number) => {
    const x = parseFloat(v(name));
    return Number.isFinite(x) ? x : fallback;
  };
  return {
    core: v("--particle-core") || DEFAULT_TOKENS.core,
    glowOpacity: n("--particle-glow-opacity", DEFAULT_TOKENS.glowOpacity),
    glowBlur: n("--particle-glow-blur", DEFAULT_TOKENS.glowBlur),
    retry: v("--status-paused") || DEFAULT_TOKENS.retry,
    dlq: v("--live-dlq") || v("--status-down") || DEFAULT_TOKENS.dlq,
    fail: v("--status-down") || DEFAULT_TOKENS.fail,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderEnv {
  /** Viewport transform: screen = flow * zoom + (x, y). */
  transform(): readonly [x: number, y: number, zoom: number];
  /** Pane size in CSS px. */
  size(): { width: number; height: number };
  /** The DOM path for an edge (`path.react-flow__edge-path`). */
  edgePath(edgeId: string): PathLike | null;
  /** A node's box in flow coordinates. */
  nodeRect(nodeId: string): Rect | null;
  /**
   * What a traced message's labels keep clear of, in pane CSS px: `hard` is never covered (node
   * cards, their badges, floating chrome), `soft` only when there's a choice (edge labels).
   */
  obstacles?(): { hard: readonly Rect[]; soft: readonly Rect[] };
}

export interface RenderOptions {
  theme: "light" | "dark";
  reducedMotion: boolean;
  /** Presentation mode draws everything a little larger. */
  scale: number;
  tokens: ParticleTokens;
}

interface Batch {
  color: string;
  kind: ParticleKind;
  /** Head positions in device px (x, y pairs). */
  heads: number[];
  /** Trails: [n, x0, y0, ..., xn-1, yn-1, n, ...] in device px. */
  trails: number[];
}

interface Pulse {
  x: number;
  y: number;
  color: string;
  start: number;
  /** "ring" = arrival, "flash" = failure around a node box. */
  type: "ring" | "flash";
  w?: number;
  h?: number;
}

interface Seen {
  edgeId: string;
  kind: ParticleKind;
  color: string;
  progress: number;
  /** Renderer frame this particle was last seen in. */
  frame: number;
}

/** Screen gap between dots on one edge, in particle sizes, below which a crowded edge is thinned. */
const DENSITY_SPACING = 2.2;

/**
 * Thinning for a crowded edge: draw one particle in `stride` (chosen by particle id, so the same
 * ones stay visible from frame to frame). 1 when the edge has room for every particle. A fallback
 * for traffic too dense even at the automatic dot scale: dots stay dots instead of a solid line.
 */
export function densityStride(count: number, pathLengthPx: number, particlePx: number): number {
  if (count <= 3 || !(pathLengthPx > 0) || !(particlePx > 0)) return 1;
  const room = Math.max(3, Math.floor(pathLengthPx / (particlePx * DENSITY_SPACING)));
  return count > room ? Math.ceil(count / room) : 1;
}

const PULSE_MS = 520;
const FLASH_MS = 700;
const MAX_PULSES = 90;
const REDUCED_MAX = 260;
/** Trail lengths in flow px. */
const TRAIL: Record<ParticleKind, number> = { message: 26, retry: 22, dlq: 40, reply: 0 };

export class ParticleRenderer {
  private ctx: CanvasRenderingContext2D;
  private cache: PathCache;
  private sprites = new Map<string, HTMLCanvasElement>();
  private batches = new Map<string, Batch>();
  private pulses: Pulse[] = [];
  private seen = new Map<number, Seen>();
  private lastPulseAt = new Map<string, number>();
  private failed = new Map<string, number>();
  private frame = 0;
  private pt = { x: 0, y: 0 };
  private perEdge = new Map<string, number>();
  private dpr = 1;
  private w = 0;
  private h = 0;
  private lastKey = "";
  private wasEmpty = true;
  /** Particles drawn in the last frame (for the stats readout and tests). */
  drawn = 0;
  /** Hit targets from the last frame, in pane CSS px: x, y, message id (for click-to-trace). */
  private hits: number[] = [];
  /** The traced message's particles this frame (device px), drawn last, brighter and labelled. */
  private focusHeads: {
    id: number;
    x: number;
    y: number;
    color: string;
    kind: ParticleKind;
    type: string;
    trail: number[];
  }[] = [];
  /** The traced message's labels in the last frame, in pane CSS px (tests read them off the canvas). */
  labels: readonly PlacedLabel[] = [];
  /** Each label's spot last frame, so it stays put while it can. */
  private labelSpots = new Map<number, number>();

  constructor(
    private canvas: HTMLCanvasElement,
    private env: RenderEnv,
    private opts: RenderOptions,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    this.cache = new PathCache((id) => env.edgePath(id));
  }

  setOptions(opts: RenderOptions): void {
    if (opts.theme !== this.opts.theme || opts.scale !== this.opts.scale || opts.tokens !== this.opts.tokens)
      this.sprites.clear();
    this.opts = opts;
    this.lastKey = "";
  }

  /** Forget cached paths and per-message history (new engine, new diagram). */
  reset(): void {
    this.cache.clear();
    this.seen.clear();
    this.pulses.length = 0;
    this.failed.clear();
    this.lastPulseAt.clear();
    this.lastKey = "";
  }

  /** Keeps the backing store at device resolution and the canvas over the visible pane. */
  private layout(): readonly [number, number, number] {
    const t = this.env.transform();
    const { width, height } = this.env.size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width !== this.w || height !== this.h || dpr !== this.dpr) {
      this.w = width;
      this.h = height;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(width * dpr));
      this.canvas.height = Math.max(1, Math.round(height * dpr));
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.lastKey = "";
    }
    // The canvas lives inside React Flow's viewport (so DOM order puts it between nodes and the
    // badges); undo the viewport transform so it covers exactly the visible pane.
    const key = `${t[0]}|${t[1]}|${t[2]}|${width}|${height}`;
    if (key !== this.lastKey) {
      this.canvas.style.transform = `translate(${-t[0] / t[2]}px, ${-t[1] / t[2]}px) scale(${1 / t[2]})`;
    }
    return t;
  }

  /**
   * The message under a pane point (CSS px from the pane's top-left), within `radius`, if any.
   * Uses the last frame's positions, so it costs nothing until someone clicks or hovers.
   */
  hitTest(x: number, y: number, radius = 12): number | undefined {
    let best: number | undefined;
    let bestD = radius * radius;
    const h = this.hits;
    for (let i = 0; i < h.length; i += 3) {
      const dx = h[i] - x,
        dy = h[i + 1] - y,
        d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = h[i + 2];
      }
    }
    return best;
  }

  /** `focus`: the traced root message id. Its particles glow and carry a label; the rest dim. */
  draw(snap: SimSnapshot, now: number, focus?: number): void {
    this.frame++;
    const [tx, ty, zoom] = this.layout();
    const key = `${tx}|${ty}|${zoom}|${this.w}|${this.h}`;
    const moved = key !== this.lastKey;
    this.lastKey = key;
    this.detectFailures(snap, now);
    const empty = snap.particles.length === 0 && this.pulses.length === 0;
    this.hits.length = 0;
    // Nothing to draw and nothing was drawn: skip the clear (keeps idle live mode at ~0% CPU).
    if (empty && this.wasEmpty && !moved) {
      this.trackArrivals(snap.particles, now);
      return;
    }
    this.wasEmpty = empty;
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const k = zoom * dpr;
    const ox = tx * dpr;
    const oy = ty * dpr;
    const reduced = this.opts.reducedMotion;
    // Particles stay legible when zoomed out and don't balloon when zoomed in.
    const size = 3.5 * this.opts.scale * Math.min(1.5, Math.max(0.75, Math.sqrt(zoom))) * dpr;
    const margin = 40 * dpr;
    const W = this.canvas.width + margin;
    const H = this.canvas.height + margin;

    for (const b of this.batches.values()) {
      b.heads.length = 0;
      b.trails.length = 0;
    }

    const particles = snap.particles;
    const stride = reduced && particles.length > REDUCED_MAX ? Math.ceil(particles.length / REDUCED_MAX) : 1;
    const perEdge = this.perEdge;
    perEdge.clear();
    for (let i = 0; i < particles.length; i += stride) {
      const id = particles[i].edgeId;
      perEdge.set(id, (perEdge.get(id) ?? 0) + 1);
    }
    let drawn = 0;
    this.focusHeads.length = 0;
    for (let i = 0; i < particles.length; i += stride) {
      const p = particles[i];
      const s = this.cache.get(p.edgeId, this.frame);
      if (!s || s.length === 0) continue;
      const focused = focus !== undefined && p.rootId === focus;
      const crowd = densityStride(perEdge.get(p.edgeId) ?? 0, s.length * k, size);
      if (!focused && crowd > 1 && p.id % crowd !== 0) continue;
      const reverse = p.kind === "reply" || p.kind === "retry";
      const t = reverse ? 1 - p.progress : p.progress;
      pointOnSamples(s, t, this.pt);
      const x = this.pt.x * k + ox;
      const y = this.pt.y * k + oy;
      if (x < -margin || y < -margin || x > W || y > H) continue;
      if (p.kind !== "reply") this.hits.push(x / dpr, y / dpr, p.messageId);
      const color = p.kind === "retry" ? this.opts.tokens.retry : p.kind === "dlq" ? this.opts.tokens.dlq : p.color;
      if (focused) {
        const trail: number[] = [];
        if (!reduced && p.kind !== "reply")
          this.pushTrail(trail, s, t, reverse, (TRAIL[p.kind] * 2) / s.length, k, ox, oy);
        this.focusHeads.push({ id: p.messageId, x, y, color, kind: p.kind, type: p.type, trail });
        drawn++;
        continue;
      }
      const bk = `${p.kind}|${color}`;
      let b = this.batches.get(bk);
      if (!b) {
        b = { color, kind: p.kind, heads: [], trails: [] };
        this.batches.set(bk, b);
      }
      b.heads.push(x, y);
      const trail = TRAIL[p.kind];
      if (trail > 0 && !reduced) this.pushTrail(b.trails, s, t, reverse, trail / s.length, k, ox, oy);
      drawn++;
    }
    this.drawn = drawn;

    // Trails under heads: a wide faint pass along the full trail, then a narrow brighter one.
    // While a message is traced, everything else steps back.
    const dark = this.opts.theme === "dark";
    const dim = focus !== undefined ? 0.2 : 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const b of this.batches.values()) {
      if (!b.trails.length) continue;
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = (dark ? 0.26 : 0.2) * dim;
      ctx.lineWidth = size * (b.kind === "dlq" ? 1.6 : 1.25);
      this.strokeTrails(b.trails, 1);
      ctx.globalAlpha = (dark ? 0.62 : 0.5) * dim;
      ctx.lineWidth = size * 0.7;
      this.strokeTrails(b.trails, 0.5);
    }
    ctx.globalAlpha = 1;

    // Heads: a light-like glow on dark canvases, normal blending on light ones.
    // "screen" glows like light but, unlike "lighter", keeps the hue when particles pile up.
    ctx.globalCompositeOperation = dark && !reduced ? "screen" : "source-over";
    for (const b of this.batches.values()) {
      if (!b.heads.length) continue;
      const r = b.kind === "reply" ? size * 0.55 : b.kind === "dlq" ? size * 1.15 : size;
      const sprite = this.sprite(b.color, b.kind, r);
      const half = sprite.width / 2;
      ctx.globalAlpha = (b.kind === "reply" ? 0.55 : 1) * (focus !== undefined ? 0.28 : 1);
      const heads = b.heads;
      for (let i = 0; i < heads.length; i += 2) ctx.drawImage(sprite, heads[i] - half, heads[i + 1] - half);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
    if (this.focusHeads.length) this.drawFocus(size, dpr);
    else if (this.labels.length) {
      this.labels = [];
      this.labelSpots.clear();
    }

    this.trackArrivals(particles, now);
    this.drawPulses(now, k, ox, oy, size);
  }

  /** The traced message and its copies: a long bright trail, a halo ring and a type label. */
  private drawFocus(size: number, dpr: number): void {
    const ctx = this.ctx;
    const dark = this.opts.theme === "dark";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const f of this.focusHeads) {
      if (!f.trail.length) continue;
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = size * 1.8;
      this.strokeTrails(f.trail, 1);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = size * 0.9;
      this.strokeTrails(f.trail, 0.6);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = dark ? "screen" : "source-over";
    for (const f of this.focusHeads) {
      const r = f.kind === "reply" ? size * 0.9 : size * 1.55;
      const sprite = this.sprite(f.color, f.kind === "reply" ? "message" : f.kind, r);
      ctx.drawImage(sprite, f.x - sprite.width / 2, f.y - sprite.height / 2);
    }
    ctx.globalCompositeOperation = "source-over";
    for (const f of this.focusHeads) {
      // A ring that reads on any background.
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = dark ? "#ffffff" : f.color;
      ctx.lineWidth = Math.max(1.5, 1.6 * dpr);
      ctx.beginPath();
      ctx.arc(f.x, f.y, size * 2.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawLabels(size, dpr);
    ctx.globalAlpha = 1;
  }

  /**
   * The type on a pill in the message colour, beside each traced particle and clear of node cards,
   * badges, chrome and each other (see traceLabels.ts). Labels follow the particle size (zoom and
   * presentation) but never drop below 11 px, so they read at a distance.
   */
  private drawLabels(size: number, dpr: number): void {
    const ctx = this.ctx;
    const font = Math.max(11 * dpr, size * 3.2);
    ctx.font = `600 ${font}px "Mona Sans Variable", ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const scaled = (r: Rect): Box => ({ x: r.x * dpr, y: r.y * dpr, w: r.width * dpr, h: r.height * dpr });
    const found = this.env.obstacles?.();
    const ring = size * 2.4;
    const colors = new Map<number, string>();
    const reqs = [];
    for (const f of this.focusHeads) {
      if (f.kind === "reply") continue;
      colors.set(f.id, f.color);
      reqs.push({
        id: f.id,
        text: f.kind === "retry" ? `${f.type} ↺` : f.kind === "dlq" ? `${f.type} → DLQ` : f.type,
        x: f.x,
        y: f.y,
        priority: f.kind === "dlq" ? 3 : f.kind === "retry" ? 2 : 1,
      });
    }
    const placed = placeTraceLabels(reqs, {
      measure: (text) => ({ w: ctx.measureText(text).width + font * 1.1, h: font * 1.75 }),
      offset: size * 2.6,
      bounds: { x: 4 * dpr, y: 4 * dpr, w: this.canvas.width - 8 * dpr, h: this.canvas.height - 8 * dpr },
      hard: found?.hard.map(scaled) ?? [],
      // Other traced particles stay visible where they can.
      soft: [
        ...(found?.soft.map(scaled) ?? []),
        ...this.focusHeads.map((f) => ({ x: f.x - ring, y: f.y - ring, w: ring * 2, h: ring * 2 })),
      ],
      previous: this.labelSpots,
    });
    this.labelSpots.clear();
    for (const l of placed) {
      this.labelSpots.set(l.id, l.spot);
      const color = colors.get(l.id) ?? "#888888";
      if (l.leader) {
        const end = nearestOnBox(l, l.ax, l.ay);
        const len = Math.hypot(end.x - l.ax, end.y - l.ay);
        if (len > ring) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, 1.25 * dpr);
          ctx.beginPath();
          ctx.moveTo(l.ax + ((end.x - l.ax) / len) * ring, l.ay + ((end.y - l.ay) / len) * ring);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      roundRect(ctx, l.x, l.y, l.w, l.h, l.h / 2);
      ctx.fill();
      ctx.fillStyle = traceLabelInk(color);
      ctx.fillText(l.text, l.x + font * 0.55, l.y + l.h / 2 + 0.5 * dpr);
    }
    this.labels = placed.map((l) => ({
      ...l,
      x: l.x / dpr,
      y: l.y / dpr,
      w: l.w / dpr,
      h: l.h / dpr,
      ax: l.ax / dpr,
      ay: l.ay / dpr,
    }));
  }

  /** Appends the polyline from the trail's tail to the head, walking the path samples. */
  private pushTrail(
    out: number[],
    s: PathSamples,
    t: number,
    reverse: boolean,
    span: number,
    k: number,
    ox: number,
    oy: number,
  ): void {
    const tail = reverse ? Math.min(1, t + span) : Math.max(0, t - span);
    if (Math.abs(tail - t) < 1e-4) return;
    const countAt = out.length;
    out.push(0);
    let n = 0;
    pointOnSamples(s, tail, this.pt);
    out.push(this.pt.x * k + ox, this.pt.y * k + oy);
    n++;
    const a = sampleIndex(s, Math.min(t, tail));
    const b = sampleIndex(s, Math.max(t, tail));
    if (reverse) {
      for (let i = b; i > a; i--) {
        out.push(s.points[i * 2] * k + ox, s.points[i * 2 + 1] * k + oy);
        n++;
      }
    } else {
      for (let i = a + 1; i <= b; i++) {
        out.push(s.points[i * 2] * k + ox, s.points[i * 2 + 1] * k + oy);
        n++;
      }
    }
    pointOnSamples(s, t, this.pt);
    out.push(this.pt.x * k + ox, this.pt.y * k + oy);
    n++;
    out[countAt] = n;
  }

  /** Strokes every trail in a batch; `part` < 1 draws only the part nearest the head. */
  private strokeTrails(trails: number[], part: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < trails.length;) {
      const n = trails[i];
      const from = i + 1 + Math.floor((n - 1) * (1 - part)) * 2;
      const end = i + 1 + n * 2;
      ctx.moveTo(trails[from], trails[from + 1]);
      for (let j = from + 2; j < end; j += 2) ctx.lineTo(trails[j], trails[j + 1]);
      i = end;
    }
    ctx.stroke();
  }

  /**
   * A message that vanished near the end of its edge has arrived: pulse at the target. Entries are
   * updated in place (no per-particle allocation per frame) and stamped with the frame they were seen.
   */
  private trackArrivals(particles: readonly Particle[], now: number): void {
    const frame = this.frame;
    for (const p of particles) {
      const s = this.seen.get(p.id);
      if (s) {
        s.progress = p.progress;
        s.frame = frame;
      } else this.seen.set(p.id, { edgeId: p.edgeId, kind: p.kind, color: p.color, progress: p.progress, frame });
    }
    for (const [id, s] of this.seen) {
      if (s.frame === frame) continue;
      this.seen.delete(id);
      if (this.opts.reducedMotion || s.progress < 0.55 || s.kind === "reply") continue;
      const last = this.lastPulseAt.get(s.edgeId) ?? -Infinity;
      if (now - last < 110 || this.pulses.length >= MAX_PULSES) continue;
      const samples = this.cache.get(s.edgeId, frame);
      if (!samples || !samples.length) continue;
      this.lastPulseAt.set(s.edgeId, now);
      // Retries end back at the broker (the edge's source).
      pointOnSamples(samples, s.kind === "retry" ? 0 : 1, this.pt);
      const color = s.kind === "retry" ? this.opts.tokens.retry : s.kind === "dlq" ? this.opts.tokens.dlq : s.color;
      this.pulses.push({ x: this.pt.x, y: this.pt.y, color, start: now, type: "ring" });
    }
  }

  /** Failed or dead-lettered counts went up since the last frame: flash the node. */
  private detectFailures(snap: SimSnapshot, now: number): void {
    for (const id in snap.nodes) {
      const n = snap.nodes[id];
      const bad = n.failed + n.deadLettered + n.dropped;
      const before = this.failed.get(id);
      this.failed.set(id, bad);
      if (before === undefined || bad <= before || this.opts.reducedMotion) continue;
      const last = this.lastPulseAt.get(`node:${id}`) ?? -Infinity;
      if (now - last < 260) continue;
      const r = this.env.nodeRect(id);
      if (!r) continue;
      this.lastPulseAt.set(`node:${id}`, now);
      this.pulses.push({
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        color: this.opts.tokens.fail,
        start: now,
        type: "flash",
      });
    }
  }

  private drawPulses(now: number, k: number, ox: number, oy: number, size: number): void {
    const ctx = this.ctx;
    let keep = 0;
    for (const p of this.pulses) {
      const age = now - p.start;
      const life = p.type === "flash" ? FLASH_MS : PULSE_MS;
      if (age >= life || age < 0) continue;
      this.pulses[keep++] = p;
      const e = age / life;
      const ease = 1 - (1 - e) * (1 - e);
      ctx.strokeStyle = p.color;
      if (p.type === "ring") {
        ctx.globalAlpha = 0.55 * (1 - e);
        ctx.lineWidth = Math.max(1, size * 0.55 * (1 - e * 0.6));
        ctx.beginPath();
        ctx.arc(p.x * k + ox, p.y * k + oy, size * (1.2 + ease * 3.4), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const grow = ease * 10 * (k / 1);
        const x = p.x * k + ox - grow;
        const y = p.y * k + oy - grow;
        const w = p.w! * k + grow * 2;
        const h = p.h! * k + grow * 2;
        ctx.globalAlpha = 0.7 * (1 - e);
        ctx.lineWidth = Math.max(1.5, 2.5 * k * (1 - e * 0.5));
        roundRect(ctx, x, y, w, h, 14 * k + grow);
        ctx.stroke();
      }
    }
    this.pulses.length = keep;
    ctx.globalAlpha = 1;
  }

  /** Pre-rendered glow + core for a colour / kind / radius. */
  private sprite(color: string, kind: ParticleKind, r: number): HTMLCanvasElement {
    const rr = Math.round(r * 4) / 4;
    const key = `${color}|${kind}|${rr}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    const reduced = this.opts.reducedMotion;
    const { core, glowOpacity, glowBlur } = this.opts.tokens;
    // --particle-glow-blur sets how far the halo reaches beyond the head.
    const reach = 1.6 + glowBlur * 0.22;
    const glow = kind === "reply" || reduced ? 1.2 : kind === "dlq" ? reach + 0.5 : reach;
    const side = Math.ceil(rr * glow * 2 + 2);
    c.width = side;
    c.height = side;
    const g = c.getContext("2d")!;
    const m = side / 2;
    const dark = this.opts.theme === "dark";
    if (glow > 1.5) {
      const grad = g.createRadialGradient(m, m, rr * 0.4, m, m, rr * glow);
      grad.addColorStop(0, withAlpha(color, glowOpacity * 0.8));
      grad.addColorStop(0.35, withAlpha(color, glowOpacity * 0.32));
      grad.addColorStop(1, withAlpha(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, side, side);
    }
    g.beginPath();
    g.arc(m, m, rr, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    if (kind !== "reply") {
      // A hot centre reads as "light" on dark canvases; a crisp rim reads on light ones.
      if (dark) {
        g.beginPath();
        g.arc(m, m, rr * 0.32, 0, Math.PI * 2);
        g.globalAlpha = 0.55;
        g.fillStyle = core;
        g.fill();
      } else {
        g.lineWidth = Math.max(1, rr * 0.28);
        g.globalAlpha = 0.9;
        g.strokeStyle = core;
        g.beginPath();
        g.arc(m, m, rr, 0, Math.PI * 2);
        g.stroke();
      }
    }
    this.sprites.set(key, c);
    return c;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** "#rrggbb" + alpha → "rgba(...)". */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
