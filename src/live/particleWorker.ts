import type { EdgeInk } from "./liveScene";
// The particle worker: draws the live view's particles, trails, pulses, trace labels and slow motion
// on the two canvases the main thread transferred (`transferControlToOffscreen`), with the very same
// ParticleRenderer and SlowPainter the main-thread fallback uses. The main thread posts one `frame`
// message per animation frame with what changed (renderProtocol.ts); each is drawn as it arrives and
// the OffscreenCanvas presents it without a main-thread paint.

import { loadCanvasFonts } from "./canvasFonts";
import type { PathSamples } from "./pathSampler";
import {
  DEFAULT_TOKENS,
  ParticleRenderer,
  context2d,
  type Obstacles,
  type Rect,
  type RenderEnv,
  type RenderOptions,
  type RenderSnapshot,
} from "./particleRenderer";
import { MarchRenderer } from "./marchRenderer";
import { GlowRenderer } from "./toggleGlow";
import {
  SnapshotUnpacker,
  type AckMessage,
  type FrameMessage,
  type FromWorker,
  type RepaintMessage,
  type ToWorker,
} from "./renderProtocol";
import { SlowPainter } from "./slowmo/painter";

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  fonts?: FontFaceSet;
  requestAnimationFrame?: (cb: (t: number) => void) => number;
}
const scope = self as unknown as WorkerScope;

function loadFonts(): void {
  void loadCanvasFonts(scope.fonts)
    .then(() => {
      if (!renderer || !last) return;
      renderer.invalidate();
      drawAndReport(last, "repaint");
    })
    .catch(() => {});
}

let canvas: OffscreenCanvas | null = null;
let overlay: OffscreenCanvas | null = null;
let renderer: ParticleRenderer | null = null;
let march: MarchRenderer | null = null;
let marchCanvas: OffscreenCanvas | null = null;
let glow: GlowRenderer | null = null;
let glowOn = false;
let glowLoop = false;

/**
 * The toggle's dot breathes on its own clock, paused or playing, like the CSS animation did: the
 * worker's own animation frames (or a 60 Hz timer where workers have none). Under reduced motion it
 * rests, drawn once.
 */
function breathe(): void {
  if (!glow || !glowOn) {
    glowLoop = false;
    return;
  }
  glow.draw(performance.now(), options.reducedMotion);
  if (options.reducedMotion) {
    glowLoop = false;
    return;
  }
  glowLoop = true;
  if (scope.requestAnimationFrame) scope.requestAnimationFrame(breathe);
  else setTimeout(breathe, 16);
}
const painter = new SlowPainter();
let slowOn = false;
const unpacker = new SnapshotUnpacker();
const paths = new Map<string, PathSamples>();
let pathsVersion = 0;
let ink = new Map<string, EdgeInk>();
let nodes = new Map<string, Rect>();
let labels: Rect[] = [];
let obstacles: Obstacles | undefined;
let snap: RenderSnapshot = { particles: [], nodes: {} };
let view = { x: 0, y: 0, zoom: 1, width: 1, height: 1, dpr: 1 };
let options: RenderOptions = { theme: "light", reducedMotion: false, scale: 1, tokens: DEFAULT_TOKENS };
let lastHits: readonly number[] | null = null;
let lastLabels = "";
let lastSlowLabels = "";
/** The last frame's clock, focus, speed and slow motion: a repaint (fonts loaded) draws it again. */
let last: Pick<FrameMessage, "epoch" | "now" | "focus" | "speed" | "slow"> | null = null;

const env: RenderEnv = {
  transform: () => [view.x, view.y, view.zoom],
  size: () => ({ width: view.width, height: view.height }),
  dpr: () => view.dpr,
  samples: (id) => paths.get(id) ?? null,
  pathsVersion: () => pathsVersion,
  edgeInk: (id) => ink.get(id),
  nodeRect: (id) => nodes.get(id) ?? null,
  obstacles: () => obstacles,
  labelRects: () => labels,
};

function sameHits(a: readonly number[], b: readonly number[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function onFrame(m: FrameMessage): void {
  if (!renderer) return;
  if (m.sync) {
    unpacker.clear();
    paths.clear();
    nodes = new Map();
    labels = [];
    obstacles = undefined;
    snap = { particles: [], nodes: {} };
    lastHits = null;
    lastLabels = lastSlowLabels = "";
    march?.setEdges([]);
    painter.reset();
    slowOn = false;
    pathsVersion++;
    renderer.reset();
  }
  if (m.options) {
    options = m.options;
    renderer.setOptions(options);
  }
  if (m.glow && glow) {
    glow.set(m.glow.color, m.glow.dpr);
    glowOn = !!m.glow.color;
  }
  if (glow && glowOn && !glowLoop) breathe();
  if (m.reset) renderer.reset();
  unpacker.apply(m.dict);
  if (m.paths) {
    for (const id of m.paths.remove) paths.delete(id);
    for (const [id, length, points] of m.paths.set) paths.set(id, { length, points });
    pathsVersion++;
  }
  if (m.nodes) nodes = new Map(m.nodes);
  if (m.ink) {
    ink = new Map(m.ink);
    pathsVersion++;
  }
  if (m.labels) labels = m.labels;
  if (m.obstacles !== undefined) obstacles = m.obstacles ?? undefined;
  if (m.snap) snap = unpacker.unpack(m.snap);
  if (m.march) march?.setEdges(m.march);
  view = m.view;
  if (m.slow) {
    slowOn = true;
    painter.backgroundAlpha = m.slow.backgroundAlpha;
    if (m.slow.frame !== undefined) painter.show(m.slow.frame, m.slow.textScale);
  } else if (slowOn) {
    // Slow motion ended: its captions and their spots go (the main thread's painter does the same).
    slowOn = false;
    painter.reset();
  }
  march?.draw(view, m.marchPhase, options.reducedMotion);
  last = { epoch: m.epoch, now: m.now, focus: m.focus, speed: m.speed, slow: m.slow };
  drawAndReport(last, "ack", m.snap?.buf);
}

/**
 * Draws and tells the main thread what it needs back. An "ack" answers a frame message (and returns
 * its particle buffer, `buf`); a "repaint" (fonts loaded) only reports, so the one frame the main
 * thread may have in flight stays in flight until its own ack.
 */
function drawAndReport(f: NonNullable<typeof last>, kind: "ack" | "repaint", buf?: ArrayBuffer): void {
  if (!renderer) return;
  renderer.draw(snap, f.now, f.focus, f.slow ? painter : undefined, f.speed);
  const base = { epoch: f.epoch, drawn: renderer.drawn, frames: renderer.frames };
  const ack: AckMessage | RepaintMessage =
    kind === "ack" ? { type: "ack", ...base, animating: renderer.animating } : { type: "repaint", ...base };
  const transfer: Transferable[] = [];
  if (buf && ack.type === "ack") {
    ack.buf = buf;
    transfer.push(buf);
  }
  const hits = renderer.hitPoints;
  if (!sameHits(hits, lastHits)) {
    lastHits = hits.slice();
    ack.hits = Float64Array.from(hits);
    transfer.push(ack.hits.buffer);
  }
  const labelKey = renderer.labels.length ? JSON.stringify(renderer.labels) : "";
  if (labelKey !== lastLabels) {
    lastLabels = labelKey;
    ack.labels = [...renderer.labels];
  }
  const slowKey = painter.labels.length ? JSON.stringify(painter.labels) : "";
  if (slowKey !== lastSlowLabels) {
    lastSlowLabels = slowKey;
    ack.slowLabels = [...painter.labels];
  }
  scope.postMessage(ack, transfer);
}

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      canvas = m.canvas;
      overlay = m.overlay;
      renderer = new ParticleRenderer(canvas, env, options, overlay);
      if (m.march) march = new MarchRenderer((marchCanvas = m.march));
      if (m.glow) glow = new GlowRenderer(m.glow);
      loadFonts();
      return;
    }
    if (m.type === "frame") {
      onFrame(m);
      return;
    }
    if (m.type === "probe") {
      const target = m.layer === "over" ? overlay : m.layer === "march" ? marchCanvas : canvas;
      const data = target
        ? context2d(target).getImageData(m.x, m.y, Math.max(1, m.w), Math.max(1, m.h)).data
        : new Uint8ClampedArray();
      scope.postMessage({ type: "probe", id: m.id, data }, [data.buffer]);
    }
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
