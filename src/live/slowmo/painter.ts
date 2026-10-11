// Draws a slow-motion frame (script.ts) over the frozen live canvas: lit edges, the dots with their
// trails, work rings around nodes, write sinks, waiting queues, landings and the captions. Called by
// the particle renderer as its overlay, with the frame's transform (see `OverlayView`).

import { pointOnSamples, type PathSamples } from "../pathSampler";
import type { OverlayView, Rect, RenderOverlay } from "../particleRenderer";
import { nearestOnBox, placeTraceLabels, traceLabelInk, type Box } from "../traceLabels";
import { formatOffset } from "../../trace/journey";
import { LIVE_BAR_SPACE } from "../layout";
import type { Anchor, SlowCaption, SlowFrame, Tone } from "./script";

/** Background traffic while slow motion plays: still and faint. */
export const BACKGROUND_ALPHA = 0.12;
/** The moving dot's trail, in CSS px. */
const TRAIL_PX = 40;

interface Ink {
  surface: string;
  text: string;
  muted: string;
  ring: string;
}
const INK: Record<"light" | "dark", Ink> = {
  dark: { surface: "rgba(16,19,26,0.94)", text: "#f3f5f9", muted: "#a9b2c1", ring: "#ffffff" },
  light: { surface: "rgba(255,255,255,0.97)", text: "#131720", muted: "#566072", ring: "" },
};

export interface PaintedLabel {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "caption" | "offset" | "retry";
  opacity: number;
  fontSize: number;
}

export class SlowPainter implements RenderOverlay {
  backgroundAlpha = BACKGROUND_ALPHA;
  frame: SlowFrame | null = null;
  /** Presentation draws the words larger. */
  textScale = 1;
  /** Captions drawn in the last frame, in pane CSS px (tests read them off the canvas). */
  labels: readonly PaintedLabel[] = [];
  private spots = new Map<number, number>();
  private ids = new Map<string, number>();
  private pt = { x: 0, y: 0 };

  /** A caption key's stable numeric id (labels keep their spot from frame to frame). */
  private id(key: string): number {
    let n = this.ids.get(key);
    if (n === undefined) {
      n = this.ids.size + 1;
      this.ids.set(key, n);
    }
    return n;
  }

  /** The frame to draw next (null: nothing), and how large its words are (presentation: larger). */
  show(frame: SlowFrame | null, textScale = 1): void {
    this.frame = frame;
    this.textScale = textScale;
  }

  reset(): void {
    this.spots.clear();
    this.ids.clear();
    this.labels = [];
  }

  paint(v: OverlayView): void {
    const f = this.frame;
    if (!f) {
      this.labels = [];
      return;
    }
    const { ctx } = v;
    const tone = (t: Tone, color: string) => (t === "warn" ? v.tokens.retry : t === "danger" ? v.tokens.dlq : color);
    const at = (edge: string, progress: number): { x: number; y: number } | null => {
      const s = v.samples(edge);
      if (!s || !s.length) return null;
      pointOnSamples(s, progress, this.pt);
      return { x: this.pt.x * v.k + v.ox, y: this.pt.y * v.k + v.oy };
    };
    const anchorAt = (a: Anchor | undefined) => (a ? at(a.edge, a.end) : null);
    const box = (node: string): Box | null => {
      const r = v.nodeRect(node);
      return r && r.width ? { x: r.x * v.k + v.ox, y: r.y * v.k + v.oy, w: r.width * v.k, h: r.height * v.k } : null;
    };
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Edges a dot travels on brighten while it does.
    for (const l of f.lit) {
      const s = v.samples(l.edge);
      if (!s || !s.length || l.alpha <= 0) continue;
      ctx.strokeStyle = l.color;
      ctx.globalAlpha = 0.22 * l.alpha;
      ctx.lineWidth = v.size * 2.2;
      this.strokePath(ctx, s, v, 0, 1);
      ctx.globalAlpha = 0.55 * l.alpha;
      ctx.lineWidth = Math.max(1.5 * v.dpr, v.size * 0.55);
      this.strokePath(ctx, s, v, 0, 1);
    }

    // Work in progress: a ring around the node that fills as the work does.
    const pad = 6 * v.dpr;
    for (const r of f.rings) {
      const b = box(r.node);
      if (!b) continue;
      const x = b.x - pad,
        y = b.y - pad,
        w = b.w + pad * 2,
        h = b.h + pad * 2;
      const radius = Math.min(16 * v.k + pad, h / 2);
      const perimeter = 2 * (w + h) - (8 - 2 * Math.PI) * radius;
      const color = tone(r.tone, r.color);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2 * v.dpr, v.size * 0.75);
      ctx.globalAlpha = 0.18 * r.alpha;
      roundRect(ctx, x, y, w, h, radius);
      ctx.stroke();
      if (r.progress > 0) {
        ctx.globalAlpha = 0.95 * r.alpha;
        ctx.setLineDash([perimeter * r.progress, perimeter]);
        roundRect(ctx, x, y, w, h, radius);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Flashes: a write lights the store's top edge in the message colour; failures and drops ring it.
    for (const fl of f.flashes) {
      const b = box(fl.node);
      if (!b) continue;
      const fade = 1 - fl.age;
      if (fl.kind === "write") {
        ctx.strokeStyle = fl.color;
        ctx.globalAlpha = 0.9 * Math.sin(Math.PI * Math.min(1, fl.age * 1.2));
        ctx.lineWidth = 3.5 * v.dpr;
        ctx.beginPath();
        ctx.moveTo(b.x + 14 * v.k, b.y - 1.5 * v.dpr);
        ctx.lineTo(b.x + b.w - 14 * v.k, b.y - 1.5 * v.dpr);
        ctx.stroke();
      } else {
        const grow = (1 - fade) * 8 * v.dpr;
        ctx.strokeStyle = fl.kind === "fail" ? v.tokens.retry : v.tokens.dlq;
        ctx.globalAlpha = 0.75 * fade;
        ctx.lineWidth = 2.5 * v.dpr;
        roundRect(ctx, b.x - grow, b.y - grow, b.w + grow * 2, b.h + grow * 2, 16 * v.k + grow);
        ctx.stroke();
      }
    }

    // Landings: the arrival ring.
    for (const l of f.landings) {
      const p = at(l.edge, l.end);
      if (!p) continue;
      ctx.strokeStyle = l.color;
      ctx.globalAlpha = 0.6 * (1 - l.age);
      ctx.lineWidth = Math.max(1, v.size * 0.55 * (1 - l.age * 0.6));
      ctx.beginPath();
      ctx.arc(p.x, p.y, v.size * (1.4 + l.age * 3.6), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Waiting: the messages ahead of it, queued back along the edge it came in on.
    for (const q of f.queues) {
      const s = v.samples(q.anchor.edge);
      if (!s || !s.length) continue;
      const step = (v.size * 2.8) / Math.max(1, s.length * v.k);
      for (let i = 1; i <= 3; i++) {
        const p = at(q.anchor.edge, q.anchor.end === 1 ? 1 - step * i : step * i);
        if (!p) continue;
        ctx.globalAlpha = 0.5 - i * 0.1;
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, v.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Dots and words go above the edge label pills (the overlay canvas, when there is one).
    ctx.restore();
    {
      const ctx = v.over;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // The dots: trails first, then heads, then a halo that reads on any background.
      const heads: { x: number; y: number; r: number; color: string; alpha: number; ring: boolean }[] = [];
      const dotAt = new Map<string, { x: number; y: number }>();
      for (const d of f.dots) {
        const p = d.edge !== undefined ? at(d.edge, d.progress ?? 0) : anchorAt(d.anchor);
        if (!p) continue;
        dotAt.set(d.key, p);
        const color = d.kind === "retry" ? v.tokens.retry : d.kind === "dlq" ? v.tokens.dlq : d.color;
        if (d.trail && d.edge !== undefined && !v.reduced) {
          const s = v.samples(d.edge);
          if (s && s.length) {
            const span = (TRAIL_PX * v.dpr) / Math.max(1, s.length * v.k);
            const reverse = d.kind === "retry";
            const head = d.progress ?? 0;
            const tail = reverse ? Math.min(1, head + span) : Math.max(0, head - span);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.3 * d.alpha;
            ctx.lineWidth = v.size * 1.8 * d.scale;
            this.strokePath(ctx, s, v, Math.min(head, tail), Math.max(head, tail));
            ctx.globalAlpha = 0.85 * d.alpha;
            ctx.lineWidth = v.size * 0.9 * d.scale;
            this.strokePath(ctx, s, v, Math.min(head, tail), Math.max(head, tail));
          }
        }
        const reply = d.kind === "reply";
        heads.push({
          x: p.x,
          y: p.y,
          r: v.size * (reply ? 0.9 : d.kind === "dlq" ? 1.75 : 1.55) * Math.max(0.05, d.scale),
          color,
          alpha: d.alpha,
          ring: !reply,
        });
      }
      const dark = v.theme === "dark";
      ctx.globalCompositeOperation = dark && !v.reduced ? "screen" : "source-over";
      for (const h of heads) {
        if (h.alpha <= 0) continue;
        const sprite = v.sprite(h.color, "message", h.r);
        ctx.globalAlpha = h.alpha;
        ctx.drawImage(sprite, h.x - sprite.width / 2, h.y - sprite.height / 2);
      }
      ctx.globalCompositeOperation = "source-over";
      for (const h of heads) {
        if (!h.ring || h.alpha <= 0.05) continue;
        ctx.globalAlpha = 0.95 * h.alpha;
        ctx.strokeStyle = dark ? INK.dark.ring : h.color;
        ctx.lineWidth = Math.max(1.5, 1.6 * v.dpr);
        ctx.beginPath();
        ctx.arc(h.x, h.y, (h.r / 1.55) * 2.3, 0, Math.PI * 2);
        ctx.stroke();
      }

      this.drawLabels(v, f, at, anchorAt, box, dotAt);
      ctx.restore();
    }
  }

  private strokePath(ctx: CanvasRenderingContext2D, s: PathSamples, v: OverlayView, from: number, to: number): void {
    const n = s.points.length / 2 - 1;
    const a = Math.max(0, Math.floor(from * n));
    const b = Math.min(n, Math.ceil(to * n));
    ctx.beginPath();
    pointOnSamples(s, from, this.pt);
    ctx.moveTo(this.pt.x * v.k + v.ox, this.pt.y * v.k + v.oy);
    for (let i = a + 1; i < b; i++) ctx.lineTo(s.points[i * 2] * v.k + v.ox, s.points[i * 2 + 1] * v.k + v.oy);
    pointOnSamples(s, to, this.pt);
    ctx.lineTo(this.pt.x * v.k + v.ox, this.pt.y * v.k + v.oy);
    ctx.stroke();
  }

  /**
   * Captions on surface pills beside their dot (the node's name in bold, then what it did and the
   * real time), types riding hops on pills in the message colour, and the visited nodes' offsets.
   * All placed clear of node cards, badges, chrome and each other (traceLabels.ts).
   */
  private drawLabels(
    v: OverlayView,
    f: SlowFrame,
    at: (edge: string, p: number) => { x: number; y: number } | null,
    anchorAt: (a: Anchor | undefined) => { x: number; y: number } | null,
    box: (node: string) => Box | null,
    dotAt: Map<string, { x: number; y: number }>,
  ): void {
    const { over: ctx, dpr } = v;
    const ink = INK[v.theme];
    const font = Math.max(12.5 * dpr * this.textScale, v.size * 3.3);
    const small = Math.max(9.5 * dpr * this.textScale, v.size * 2.1);
    const bold = (px: number) => `650 ${px}px "Mona Sans Variable", ui-sans-serif, system-ui, sans-serif`;
    const regular = (px: number) => `500 ${px}px "Mona Sans Variable", ui-sans-serif, system-ui, sans-serif`;
    const mono = (px: number) => `500 ${px}px "Geist Mono Variable", ui-monospace, monospace`;
    type Req = {
      id: number;
      text: string;
      x: number;
      y: number;
      priority: number;
      c: SlowCaption | null;
      alpha?: number;
    };
    const reqs: Req[] = [];
    const style = new Map<number, Req>();
    for (const c of f.captions) {
      let p: { x: number; y: number } | null = null;
      // A hop's words ride its dot; a node's words sit on the node (above it, or beside it).
      if (c.edge !== undefined) p = at(c.edge, c.progress ?? 0);
      else if (c.node) {
        const b = box(c.node);
        if (b) p = { x: b.x + b.w * 0.35, y: b.y };
      }
      if (!p) p = anchorAt(c.anchor);
      if (!p) continue;
      const req = { id: this.id(c.key), text: c.text, x: p.x, y: p.y, priority: c.priority, c };
      reqs.push(req);
      style.set(req.id, req);
    }
    const visitedFont = small;
    const isPill = (c: SlowCaption | null) => !!c && c.edge !== undefined;
    const split = (text: string) => {
      const i = text.indexOf(" · ");
      return i > 0 ? [text.slice(0, i), text.slice(i)] : [text, ""];
    };
    const measure = (text: string, req?: Req) => {
      if (req && !req.c) {
        ctx.font = mono(visitedFont);
        return { w: ctx.measureText(text).width + visitedFont * 1.1, h: visitedFont * 1.7 };
      }
      if (req?.c?.chip) {
        ctx.font = bold(small);
        return { w: ctx.measureText(text).width + small * 1.2, h: small * 1.8 };
      }
      if (req && isPill(req.c)) {
        ctx.font = bold(font);
        return { w: ctx.measureText(text).width + font * 1.2, h: font * 1.8 };
      }
      const [head, tail] = split(text);
      ctx.font = bold(font);
      let w = ctx.measureText(head).width;
      ctx.font = regular(font);
      w += ctx.measureText(tail).width;
      return { w: w + font * 2.1, h: font * 2.1 };
    };
    // Merged copies read "OrderPlaced ×3": measure them like their first.
    const byText = new Map(reqs.map((r) => [r.text, r]));
    const lookup = (text: string) => byText.get(text) ?? byText.get(text.replace(/ ×\d+$/, ""));
    const scaled = (r: Rect): Box => ({ x: r.x * dpr, y: r.y * dpr, w: r.width * dpr, h: r.height * dpr });
    const found = v.obstacles();
    const ring = v.size * 2.6;
    const hard = found?.hard.map(scaled) ?? [];
    const env = {
      offset: v.size * 2.8,
      bounds: { x: 4 * dpr, y: 4 * dpr, w: v.width - 8 * dpr, h: v.height - 8 * dpr },
      soft: [
        ...(found?.soft.map(scaled) ?? []),
        ...[...dotAt.values()].map((p) => ({ x: p.x - ring, y: p.y - ring, w: ring * 2, h: ring * 2 })),
      ],
      previous: this.spots,
    };
    // Hops' types first (copies close together merge: "OrderPlaced ×3"), then each node's caption
    // beside its node; one with no room there tries its short form (without the node's name).
    const pills = reqs.filter((r) => isPill(r.c));
    const placed = placeTraceLabels(pills, { ...env, hard, measure: (text) => measure(text, lookup(text)) });
    const nodeReqs = reqs.filter((r) => !isPill(r.c)).sort((a, b) => b.priority - a.priority);
    /** Captions with no room beside their node (parallel work in a dense column): the dock. */
    const overflow: Req[] = [];
    for (const req of nodeReqs) {
      const place = (r: Req) =>
        placeTraceLabels([r], { ...env, hard: [...hard, ...placed], measure: (text) => measure(text, r) })[0];
      // Beside the node or not at all: the full caption, then without the node's name, then
      // just the real time ("150 ms"). The trace card and screen readers always get the full words.
      const tries = [req.text, req.c?.short, lastDuration(req.text)];
      let got: ReturnType<typeof place> | undefined;
      for (const [n, text] of tries.entries()) {
        if (!text) continue;
        const one = place({ ...req, text });
        if (one && !one.leader) {
          got = one;
          if (n === 2) overflow.push(req);
          break;
        }
      }
      if (got) placed.push(got);
      else if (!req.c?.chip) overflow.push(req);
    }
    // The dock: those captions in full, stacked just above the live bar, centred, where they cover
    // nothing (a line with no room is left out; the trace card has every hop).
    const lineH = font * 2.1;
    let floor = v.height - (LIVE_BAR_SPACE + 10) * dpr;
    for (const req of overflow.slice(0, 3)) {
      const { w, h } = measure(req.text, req);
      for (let y = floor - h; y > floor - h - lineH * 4; y -= lineH / 2) {
        const b = { x: (v.width - w) / 2, y, w, h };
        if ([...hard, ...placed].some((o) => overlaps(b, o))) continue;
        placed.push({ ...b, id: req.id, text: req.text, count: 1, ax: b.x, ay: b.y, leader: false, spot: -1 });
        floor = y - 6 * dpr;
        break;
      }
    }
    // Where it's been: the real offset at each node reached, one at a time (never merged), each
    // clear of the captions and the offsets before it, and left out when there's no room.
    for (const [index, vis] of f.visited.entries()) {
      const b = box(vis.node);
      if (!b) continue;
      const req: Req = {
        id: this.id(`v:${vis.node}`),
        text: formatOffset(vis.real),
        x: b.x + b.w,
        y: b.y,
        priority: 0,
        c: null,
        alpha: Math.max(0.35, 0.8 - (f.visited.length - 1 - index) * 0.09),
      };
      style.set(req.id, req);
      const one = placeTraceLabels([req], {
        ...env,
        offset: 4 * dpr,
        hard: [...hard, ...(found?.soft.map(scaled) ?? []), ...placed],
        measure: (text) => measure(text, req),
      });
      // Offsets sit right by their node, or not at all.
      if (one[0] && !one[0].leader) placed.push(one[0]);
    }
    this.spots.clear();
    ctx.textBaseline = "middle";
    for (const l of placed) {
      if (l.spot >= 0) this.spots.set(l.id, l.spot);
      const req = style.get(l.id);
      const c = req?.c ?? null;
      const color = c ? (c.tone === "warn" ? v.tokens.retry : c.tone === "danger" ? v.tokens.dlq : c.color) : ink.muted;
      if (l.leader && c) {
        const end = nearestOnBox(l, l.ax, l.ay);
        const len = Math.hypot(end.x - l.ax, end.y - l.ay);
        if (len > ring) {
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, 1.25 * dpr);
          ctx.beginPath();
          ctx.moveTo(l.ax + ((end.x - l.ax) / len) * ring, l.ay + ((end.y - l.ay) / len) * ring);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (!c) {
        // A visited node's offset: quiet, monospaced.
        ctx.fillStyle = ink.surface;
        roundRect(ctx, l.x, l.y, l.w, l.h, l.h / 2);
        ctx.globalAlpha = (req?.alpha ?? 0.8) * 0.65;
        ctx.fill();
        ctx.globalAlpha = req?.alpha ?? 0.8;
        ctx.font = mono(visitedFont);
        ctx.fillStyle = ink.muted;
        ctx.fillText(l.text, l.x + visitedFont * 0.55, l.y + l.h / 2 + 0.5 * dpr);
        continue;
      }
      if (c.chip) {
        ctx.fillStyle = ink.surface;
        roundRect(ctx, l.x, l.y, l.w, l.h, l.h / 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = bold(small);
        ctx.fillStyle = color;
        ctx.fillText(l.text, l.x + small * 0.6, l.y + l.h / 2 + 0.5 * dpr);
        continue;
      }
      if (isPill(c)) {
        ctx.fillStyle = color;
        roundRect(ctx, l.x, l.y, l.w, l.h, l.h / 2);
        ctx.fill();
        ctx.font = bold(font);
        ctx.fillStyle = traceLabelInk(color);
        ctx.fillText(l.text, l.x + font * 0.6, l.y + l.h / 2 + 0.5 * dpr);
        continue;
      }
      // A caption card: a colour bar, the node in bold, then the rest.
      ctx.fillStyle = ink.surface;
      roundRect(ctx, l.x, l.y, l.w, l.h, 8 * dpr);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = c.tone === "plain" ? 0.45 : 0.8;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      roundRect(ctx, l.x + font * 0.45, l.y + l.h * 0.26, 3.5 * dpr, l.h * 0.48, 2 * dpr);
      ctx.fill();
      const [head, tail] = l.count > 1 ? [l.text, ""] : split(l.text);
      let x = l.x + font * 0.45 + 3.5 * dpr + font * 0.5;
      const y = l.y + l.h / 2 + 0.5 * dpr;
      ctx.font = bold(font);
      ctx.fillStyle = ink.text;
      ctx.fillText(head, x, y);
      x += ctx.measureText(head).width;
      if (tail) {
        ctx.font = regular(font);
        ctx.fillStyle = ink.muted;
        ctx.fillText(tail, x, y);
      }
    }
    this.labels = placed.map((l) => {
      const req = style.get(l.id);
      return {
        text: l.text,
        x: l.x / dpr,
        y: l.y / dpr,
        w: l.w / dpr,
        h: l.h / dpr,
        kind: !req?.c ? "offset" : req.c.chip ? "retry" : "caption",
        opacity: req?.alpha ?? 1,
        fontSize: (!req?.c || req.c.chip ? small : font) / dpr,
      };
    });
  }
}

/** The last real time in a caption ("150 ms", "2.4 s"): the words of last resort beside a node. */
export function lastDuration(text: string): string | undefined {
  return [...text.matchAll(/\d[\d.,]* (?:ms|s|min)(?![a-z])/g)].at(-1)?.[0];
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
