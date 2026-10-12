// The live view's particle renderer, as the frame loop sees it. Two implementations share every line
// of drawing code (ParticleRenderer, SlowPainter, MarchRenderer):
//
//  - "worker" (the default where supported): the canvases (particles, the overlay above the edge
//    label pills, and the marching ants in the edge layer) are handed to a module worker with
//    `transferControlToOffscreen`, and the worker draws (particleWorker.ts). Per frame the main thread
//    only steps the engine, packs the particles into a transferable buffer when the snapshot changed,
//    and posts one message; it never paints, so menus and the palette answer input in the next frame
//    instead of two frames deep. Paths, node boxes, label pills, obstacles and the marching edges'
//    looks are read here (LiveScene) and posted only when they change.
//  - "main" (the fallback): the same renderer draws on the canvases from the main thread, as before.
//    Used when OffscreenCanvas or module workers aren't available, with `?renderer=main`, or after the
//    worker failed to start.
//
// Either way the main thread places the canvases over the pane (CSS size and the inverse viewport
// transform), with the transform the frame was drawn with.

import type { PlacedLabel } from "./traceLabels";
import type { PaintedLabel, SlowPainter } from "./slowmo/painter";
import type { SlowFrame } from "./slowmo/script";
import { LiveScene, type FlowStoreLike } from "./liveScene";
import { MarchRenderer, type MarchEdge } from "./marchRenderer";
import {
  ParticleRenderer,
  hitTestPoints,
  type Obstacles,
  type Rect,
  type RenderOptions,
  type RenderSnapshot,
} from "./particleRenderer";
import {
  SnapshotPacker,
  postablePaths,
  type FrameMessage,
  type FromWorker,
  type Layer,
  type ToWorker,
  type ViewState,
} from "./renderProtocol";

export type RendererKind = "worker" | "main";

/** A layer's pixels (test hook): RGBA rows of `width`, pixel (i, j) at client (x + i / scale, y + j / scale). */
export interface ProbeResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

export interface FrameInput {
  snap: RenderSnapshot;
  /** The animation frame's timestamp. */
  now: number;
  /** Playback speed (the calm sampler thins slow speeds). */
  speed: number;
  /** The traced root message. */
  focus?: number;
  /** Slow motion's painter while it plays. */
  slow?: SlowPainter;
  /** How far into the marching ants (ms of moving simulation; 0 while slow motion plays). */
  march: number;
}

export interface LiveRenderer {
  readonly kind: RendererKind;
  setOptions(opts: RenderOptions): void;
  /** A new engine: forget per-message history. */
  reset(): void;
  /** Once per animation frame. */
  frame(input: FrameInput): void;
  /** The message under a pane point (CSS px), from the last drawn frame. */
  hitTest(x: number, y: number, radius?: number): number | undefined;
  /** The UI clock, right after the decorator ran: re-read the marching edges, node boxes and paths. */
  tick(): void;
  /** Particles in the last drawn frame. */
  readonly drawn: number;
  /** Frames drawn so far. */
  readonly frames: number;
  /** The traced message's labels (pane CSS px). */
  readonly labels: readonly PlacedLabel[];
  /** Slow motion's captions (pane CSS px). */
  readonly slowLabels: readonly PaintedLabel[];
  /** Test hook: RGBA pixels of a layer inside a rect in client CSS px (wherever the layer is drawn). */
  probe(layer: Layer, rect: { x: number; y: number; width: number; height: number }): Promise<ProbeResult>;
  dispose(): void;
}

export interface RendererSetup {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  root: HTMLElement;
  store: FlowStoreLike;
  /** Edge label pills in flow coordinates (identity changes when they move). */
  labelRects: () => readonly Rect[];
  options: RenderOptions;
  /** The worker couldn't start or crashed: the caller remounts the canvases on the main path. */
  onFail?: (reason: string) => void;
}

// ------------------------------------------------------------------ capability check

/**
 * The one capability check: OffscreenCanvas with a 2D context, `transferControlToOffscreen` and
 * module workers. `?renderer=main` forces the fallback (tests, and anyone who needs it).
 */
export function pickRenderer(search = typeof location !== "undefined" ? location.search : ""): RendererKind {
  if (new URLSearchParams(search).get("renderer") === "main") return "main";
  return canRenderInWorker() ? "worker" : "main";
}

let workerSupport: boolean | undefined;

/** The worker couldn't even start here (a CSP, disabled workers): later sessions skip straight to the fallback. */
export function markWorkerUnsupported(): void {
  workerSupport = false;
}

export function canRenderInWorker(): boolean {
  if (workerSupport !== undefined) return workerSupport;
  workerSupport = false;
  if (
    typeof Worker !== "function" ||
    typeof OffscreenCanvas !== "function" ||
    typeof OffscreenCanvasRenderingContext2D !== "function" ||
    typeof HTMLCanvasElement === "undefined" ||
    !("transferControlToOffscreen" in HTMLCanvasElement.prototype)
  )
    return false;
  // Module workers: the constructor reads `type` only if it knows the option. An unparsable URL
  // throws after the options were read, so nothing is fetched or started.
  let module = false;
  try {
    const options = {
      get type() {
        module = true;
        return "module" as const;
      },
    };
    new Worker("http://[", options).terminate();
  } catch {
    // Expected: the URL doesn't parse.
  }
  workerSupport = module;
  return module;
}

// ------------------------------------------------------------------ the march canvas

/** Marks the root while a canvas draws the marching ants (live.css stops the SVG's own march). */
const MARCH_ATTR = "data-live-march";

/**
 * The marching ants' canvas: last in React Flow's edge layer, so it paints above the edges and below
 * the nodes (the particle canvases sit above the nodes). Null when there's no edge layer.
 */
function mountMarchCanvas(root: HTMLElement): HTMLCanvasElement | null {
  const layer = root.querySelector(".react-flow__edges");
  if (!layer) return null;
  const el = document.createElement("canvas");
  el.className = "lv-canvas lv-canvas-march";
  el.dataset.testid = "live-canvas-march";
  el.setAttribute("aria-hidden", "true");
  layer.appendChild(el);
  return el;
}

/** Marks the root while the worker draws the Live toggle's breathing glow (live.css stops `lv-breathe`). */
const GLOW_ATTR = "data-live-glow";

/** The toggle's glow canvas, inside its dot (toggleGlow.ts). Null without a toggle (the Lab). */
function mountGlowCanvas(root: HTMLElement): HTMLCanvasElement | null {
  const dot = root.querySelector('[data-testid="live-toggle"] .lv-toggle-dot');
  if (!dot) return null;
  const el = document.createElement("canvas");
  el.className = "lv-toggle-glow";
  el.dataset.testid = "live-toggle-glow";
  el.setAttribute("aria-hidden", "true");
  dot.appendChild(el);
  return el;
}

/** Keeps the march canvas last in the edge layer (edges mounted later would paint over it). */
function keepLast(el: HTMLCanvasElement | null, root: HTMLElement): void {
  if (!el) return;
  const layer = root.querySelector(".react-flow__edges");
  if (layer && (el.parentElement !== layer || el.nextSibling)) layer.appendChild(el);
}

// ------------------------------------------------------------------ placement

/**
 * The canvases live inside React Flow's viewport (so DOM order puts them between the nodes and the
 * badges); this undoes the viewport transform so they cover exactly the visible pane.
 */
export class CanvasPlacement {
  private sizeKey = "";
  private key = "";
  constructor(private els: readonly (HTMLCanvasElement | null)[]) {}

  place(v: ViewState): void {
    const sizeKey = `${v.width}|${v.height}`;
    if (sizeKey !== this.sizeKey) {
      this.sizeKey = sizeKey;
      for (const el of this.els) {
        if (!el) continue;
        el.style.width = `${v.width}px`;
        el.style.height = `${v.height}px`;
      }
    }
    const key = `${v.x}|${v.y}|${v.zoom}`;
    if (key !== this.key) {
      this.key = key;
      const t = `translate(${-v.x / v.zoom}px, ${-v.y / v.zoom}px) scale(${1 / v.zoom})`;
      for (const el of this.els) if (el) el.style.transform = t;
    }
  }
}

function viewOf(scene: LiveScene): ViewState {
  const [x, y, zoom] = scene.transform();
  const { width, height } = scene.size();
  return { x, y, zoom, width, height, dpr: scene.dpr() };
}

/** Client CSS px → the layer's device px. */
function deviceRect(
  canvas: HTMLCanvasElement,
  dpr: number,
  r: { x: number; y: number; width: number; height: number },
) {
  const box = canvas.getBoundingClientRect();
  // The canvas box is the pane in CSS px (the inverse transform cancels the zoom).
  const sx = box.width ? (canvas.style.width ? parseFloat(canvas.style.width) / box.width : 1) * dpr : dpr;
  const sy = box.height ? (canvas.style.height ? parseFloat(canvas.style.height) / box.height : 1) * dpr : dpr;
  return {
    x: Math.max(0, Math.floor((r.x - box.left) * sx)),
    y: Math.max(0, Math.floor((r.y - box.top) * sy)),
    w: Math.max(1, Math.floor(r.width * sx)),
    h: Math.max(1, Math.floor(r.height * sy)),
    left: box.left,
    top: box.top,
    scale: sx,
  };
}

function probeResult(data: Uint8ClampedArray, r: ReturnType<typeof deviceRect>): ProbeResult {
  return { data, width: r.w, height: r.h, x: r.left + r.x / r.scale, y: r.top + r.y / r.scale, scale: r.scale };
}

const NO_PIXELS: ProbeResult = { data: new Uint8ClampedArray(), width: 0, height: 0, x: 0, y: 0, scale: 1 };

export function createLiveRenderer(kind: RendererKind, setup: RendererSetup): LiveRenderer {
  return kind === "worker" ? new WorkerRenderer(setup) : new MainThreadRenderer(setup);
}

// ------------------------------------------------------------------ main thread (fallback)

class MainThreadRenderer implements LiveRenderer {
  readonly kind = "main";
  private scene: LiveScene;
  private core: ParticleRenderer;
  private placement: CanvasPlacement;
  private slow: SlowPainter | undefined;
  private marchCanvas: HTMLCanvasElement | null;
  private march: MarchRenderer | null = null;
  private marchEdges: readonly MarchEdge[] | null = null;
  private reduced: boolean;

  constructor(private setup: RendererSetup) {
    this.scene = new LiveScene(setup.root, setup.store);
    const scene = this.scene;
    this.reduced = setup.options.reducedMotion;
    this.marchCanvas = mountMarchCanvas(setup.root);
    if (this.marchCanvas) {
      this.march = new MarchRenderer(this.marchCanvas);
      setup.root.setAttribute(MARCH_ATTR, "canvas");
    }
    this.placement = new CanvasPlacement([setup.canvas, setup.overlay, this.marchCanvas]);
    this.core = new ParticleRenderer(
      setup.canvas,
      {
        transform: () => scene.transform(),
        size: () => scene.size(),
        dpr: () => scene.dpr(),
        samples: (id) => scene.samples(id),
        pathsVersion: () => scene.pathsVersion,
        nodeRect: (id) => scene.nodeRect(id),
        obstacles: () => scene.obstacles(),
        labelRects: () => setup.labelRects(),
      },
      setup.options,
      setup.overlay,
    );
  }

  setOptions(opts: RenderOptions): void {
    this.reduced = opts.reducedMotion;
    this.core.setOptions(opts);
  }
  reset(): void {
    this.core.reset();
  }
  frame(f: FrameInput): void {
    this.scene.refresh();
    const view = viewOf(this.scene);
    this.placement.place(view);
    this.slow = f.slow;
    this.core.draw(f.snap, f.now, f.focus, f.slow, f.speed);
    if (this.march) {
      if (this.scene.march !== this.marchEdges) this.march.setEdges((this.marchEdges = this.scene.march));
      this.march.draw(view, f.march, this.reduced);
    }
  }
  tick(): void {
    this.scene.refresh(true);
    this.scene.readMarch();
    keepLast(this.marchCanvas, this.setup.root);
  }
  hitTest(x: number, y: number, radius?: number): number | undefined {
    return this.core.hitTest(x, y, radius);
  }
  get drawn(): number {
    return this.core.drawn;
  }
  get frames(): number {
    return this.core.frames;
  }
  get labels(): readonly PlacedLabel[] {
    return this.core.labels;
  }
  get slowLabels(): readonly PaintedLabel[] {
    return this.slow?.labels ?? [];
  }
  probe(layer: Layer, rect: { x: number; y: number; width: number; height: number }): Promise<ProbeResult> {
    const el = layer === "over" ? this.setup.overlay : layer === "march" ? this.marchCanvas : this.setup.canvas;
    if (!el) return Promise.resolve(NO_PIXELS);
    const r = deviceRect(el, this.scene.dpr(), rect);
    const data = el.getContext("2d")?.getImageData(r.x, r.y, r.w, r.h).data;
    return Promise.resolve(data ? probeResult(data, r) : NO_PIXELS);
  }
  dispose(): void {
    this.scene.dispose();
    this.marchCanvas?.remove();
    this.setup.root.removeAttribute(MARCH_ATTR);
  }
}

// ------------------------------------------------------------------ worker

/**
 * A worker and the canvases it owns. `transferControlToOffscreen` works once per canvas, and React's
 * development StrictMode unmounts and remounts effects at once: a released host lingers for a task,
 * so an immediate re-acquire of the same canvas gets it back instead of a dead canvas.
 */
interface WorkerHost {
  worker: Worker;
  /** The marching ants' canvas and the toggle's glow (created with the host, removed with it). */
  march: HTMLCanvasElement | null;
  glow: HTMLCanvasElement | null;
  listener: ((m: FromWorker) => void) | null;
  fail: ((reason: string) => void) | null;
  disposeTimer?: ReturnType<typeof setTimeout>;
}
const hosts = new WeakMap<HTMLCanvasElement, WorkerHost>();

/**
 * Starts a worker on these canvases, all or nothing: the constructor (a CSP, Trusted Types, disabled
 * workers), a transfer (a canvas already transferred) or the first message can throw, and then the
 * worker is terminated, the canvases it added are removed and the error goes to the caller, which
 * hands over to the main thread on fresh canvases.
 */
function acquireHost(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, root: HTMLElement): WorkerHost {
  const existing = hosts.get(canvas);
  if (existing) {
    clearTimeout(existing.disposeTimer);
    existing.disposeTimer = undefined;
    keepLast(existing.march, root);
    return existing;
  }
  let worker: Worker | undefined;
  let march: HTMLCanvasElement | null = null;
  let glow: HTMLCanvasElement | null = null;
  try {
    worker = new Worker(new URL("./particleWorker.ts", import.meta.url), { type: "module", name: "particles" });
    march = mountMarchCanvas(root);
    glow = mountGlowCanvas(root);
    const host: WorkerHost = { worker, march, glow, listener: null, fail: null };
    worker.onmessage = (e: MessageEvent<FromWorker>) => host.listener?.(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      host.fail?.(e.message || "the particle worker failed to load");
    };
    worker.onmessageerror = () => host.fail?.("a message from the particle worker couldn't be read");
    const base = canvas.transferControlToOffscreen();
    const over = overlay.transferControlToOffscreen();
    const ants = march?.transferControlToOffscreen();
    const breath = glow?.transferControlToOffscreen();
    const init: ToWorker = {
      type: "init",
      canvas: base,
      overlay: over,
      ...(ants && { march: ants }),
      ...(breath && { glow: breath }),
    };
    const transfer: Transferable[] = [base, over];
    if (ants) transfer.push(ants);
    if (breath) transfer.push(breath);
    worker.postMessage(init, transfer);
    hosts.set(canvas, host);
    return host;
  } catch (err) {
    worker?.terminate();
    march?.remove();
    glow?.remove();
    throw err;
  }
}

/** The edges a slow-motion frame draws on (their samples must reach the worker). */
export function slowEdges(frame: SlowFrame | null): string[] {
  if (!frame) return [];
  const out: string[] = [];
  for (const d of frame.dots) {
    if (d.edge !== undefined) out.push(d.edge);
    if (d.anchor) out.push(d.anchor.edge);
  }
  for (const l of frame.lit) out.push(l.edge);
  for (const l of frame.landings) out.push(l.edge);
  for (const q of frame.queues) out.push(q.anchor.edge);
  for (const c of frame.captions) {
    if (c.edge !== undefined) out.push(c.edge);
    if (c.anchor) out.push(c.anchor.edge);
  }
  return out;
}

function releaseHost(canvas: HTMLCanvasElement, host: WorkerHost): void {
  host.listener = null;
  host.fail = null;
  host.disposeTimer = setTimeout(() => {
    host.worker.terminate();
    host.march?.remove();
    host.glow?.remove();
    hosts.delete(canvas);
  }, 0);
}

/** A worker that hasn't answered the first frame by then counts as failed (the fallback takes over). */
const START_TIMEOUT_MS = 10_000;
let epochs = 0;

class WorkerRenderer implements LiveRenderer {
  readonly kind = "worker";
  private scene: LiveScene;
  /** Null when the worker couldn't start (the fallback is on its way). */
  private host: WorkerHost | null = null;
  private placement: CanvasPlacement;
  private packer = new SnapshotPacker();
  private epoch = ++epochs;
  private synced = false;
  private inFlight = false;
  private started = false;
  private startTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private failed = false;
  // What was last posted (only changes are sent).
  private options: RenderOptions;
  private optionsDirty = true;
  private resetPending = false;
  private sentSnap: RenderSnapshot | null = null;
  private sentLabels: readonly Rect[] | null = null;
  private sentObstacles: Obstacles | null = null;
  private sentSlow: SlowPainter | undefined;
  private sentSlowRevision = -1;
  private sentViewKey = "";
  private sentFocus: number | undefined;
  private sentSpeed = NaN;
  private sentMarchPhase = NaN;
  private glowKey = "|";
  private glowPending: { color: string; dpr: number } | null = null;
  private workerAnimating = false;
  // What the worker reported.
  private hits: Float64Array = new Float64Array();
  drawn = 0;
  frames = 0;
  labels: readonly PlacedLabel[] = [];
  slowLabels: readonly PaintedLabel[] = [];
  private probes = new Map<number, (data: Uint8ClampedArray) => void>();
  private probeId = 0;

  constructor(private setup: RendererSetup) {
    this.scene = new LiveScene(setup.root, setup.store);
    this.options = setup.options;
    try {
      this.host = acquireHost(setup.canvas, setup.overlay, setup.root);
      this.host.listener = (m) => this.onMessage(m);
      this.host.fail = (reason) => this.fail(reason);
    } catch (err) {
      // It never started: this browser can't run it, so later sessions skip it too. The handover
      // waits a microtask, so the caller's effect finishes setting up (and can dispose this) first.
      markWorkerUnsupported();
      const reason = `the particle worker couldn't start (${err instanceof Error ? err.message : String(err)})`;
      queueMicrotask(() => this.fail(reason));
    }
    this.placement = new CanvasPlacement([setup.canvas, setup.overlay, this.host?.march ?? null]);
  }

  private fail(reason: string): void {
    if (this.failed || this.disposed) return;
    this.failed = true;
    clearTimeout(this.startTimer);
    this.setup.root.removeAttribute(MARCH_ATTR);
    this.setup.root.removeAttribute(GLOW_ATTR);
    this.setup.onFail?.(reason);
  }

  private onMessage(m: FromWorker): void {
    if (m.type === "error") {
      this.fail(m.message);
      return;
    }
    if (m.type === "probe") {
      this.probes.get(m.id)?.(m.data);
      this.probes.delete(m.id);
      return;
    }
    if (m.type === "ack" && m.buf) this.packer.recycle(m.buf);
    if (m.epoch !== this.epoch) return;
    // A repaint the worker did on its own (fonts loaded) brings fresh stats, but it isn't the answer
    // to the frame in flight: only an ack releases the next frame.
    if (m.type === "ack") {
      if (!this.started) {
        this.started = true;
        clearTimeout(this.startTimer);
        // The worker draws: the SVG's own march and the dot's CSS breath step aside for its canvases.
        if (this.host?.march) this.setup.root.setAttribute(MARCH_ATTR, "canvas");
        if (this.host?.glow) this.setup.root.setAttribute(GLOW_ATTR, "canvas");
      }
      this.inFlight = false;
      this.workerAnimating = m.animating;
    }
    this.drawn = m.drawn;
    this.frames = m.frames;
    if (m.hits) this.hits = m.hits;
    if (m.labels) this.labels = m.labels;
    if (m.slowLabels) this.slowLabels = m.slowLabels;
  }

  setOptions(opts: RenderOptions): void {
    this.options = opts;
    this.optionsDirty = true;
  }

  reset(): void {
    this.resetPending = true;
  }

  tick(): void {
    this.scene.refresh(true);
    this.scene.readMarch();
    keepLast(this.host?.march ?? null, this.setup.root);
    this.readGlow();
  }

  /** The dot's colour (its computed background follows the theme) and the pixel ratio, for the glow. */
  private readGlow(): void {
    const dot = this.host?.glow?.parentElement;
    if (!dot) return;
    const color = dot.closest(".lv-toggle.is-on") ? getComputedStyle(dot).backgroundColor : "";
    const dpr = this.scene.dpr();
    const key = `${color}|${dpr}`;
    if (key === this.glowKey) return;
    this.glowKey = key;
    this.glowPending = { color, dpr };
  }

  frame(f: FrameInput): void {
    const host = this.host;
    if (this.disposed || this.failed || !host) return;
    this.scene.refresh();
    // One frame in flight at most: a busy worker draws the latest state, never a backlog.
    if (this.inFlight) return;
    const view = viewOf(this.scene);
    const viewKey = `${view.x}|${view.y}|${view.zoom}|${view.width}|${view.height}|${view.dpr}`;
    const needsObstacles = f.focus !== undefined || !!f.slow;
    const obstacles = needsObstacles ? this.scene.obstacles() : null;
    const labels = this.setup.labelRects();
    const slowRevision = f.slow?.revision ?? -1;
    const slowChanged = f.slow !== this.sentSlow || slowRevision !== this.sentSlowRevision;
    const sync = !this.synced;
    if (sync) this.packer.clear();
    // Pack first: the edges particles ride for the first time are the paths the worker needs.
    const snapChanged = f.snap !== this.sentSnap || sync;
    const packed = snapChanged ? this.packer.pack(f.snap) : undefined;
    const dict = this.packer.takeDict();
    for (const id of dict?.edges ?? []) this.scene.want(id);
    if (f.slow && slowChanged) for (const id of slowEdges(f.slow.frame)) this.scene.want(id);
    const changes = sync ? this.scene.everything() : this.scene.takeChanges();
    if (
      !sync &&
      !changes &&
      !snapChanged &&
      !this.scene.backlog &&
      !this.optionsDirty &&
      !this.resetPending &&
      !this.workerAnimating &&
      !this.glowPending &&
      viewKey === this.sentViewKey &&
      f.focus === this.sentFocus &&
      f.speed === this.sentSpeed &&
      f.march === this.sentMarchPhase &&
      !slowChanged &&
      labels === this.sentLabels &&
      obstacles === this.sentObstacles
    )
      return;

    const msg: FrameMessage = {
      type: "frame",
      epoch: this.epoch,
      view,
      now: f.now,
      speed: f.speed,
      focus: f.focus,
      marchPhase: f.march,
      slow: f.slow
        ? {
            textScale: f.slow.textScale,
            backgroundAlpha: f.slow.backgroundAlpha,
            ...(slowChanged ? { frame: f.slow.frame } : {}),
          }
        : null,
    };
    const transfer: Transferable[] = [];
    if (sync) {
      msg.sync = true;
      this.synced = true;
    }
    if (this.optionsDirty || sync) msg.options = this.options;
    if (this.resetPending) msg.reset = true;
    if (packed) {
      msg.snap = packed;
      transfer.push(packed.buf);
    }
    if (dict) msg.dict = dict;
    if (changes?.paths) {
      msg.paths = { set: postablePaths(changes.paths.set), remove: changes.paths.remove };
      for (const [, , points] of msg.paths.set) transfer.push(points.buffer);
    }
    if (changes?.nodes) msg.nodes = changes.nodes;
    if (changes?.march) msg.march = changes.march;
    if (this.glowPending) msg.glow = this.glowPending;
    if (labels !== this.sentLabels || msg.sync) msg.labels = [...labels];
    if (obstacles !== this.sentObstacles || msg.sync)
      msg.obstacles = obstacles ? { hard: obstacles.hard, soft: obstacles.soft } : null;

    try {
      host.worker.postMessage(msg, transfer);
    } catch (err) {
      this.fail(`a frame couldn't be posted to the particle worker (${err instanceof Error ? err.message : err})`);
      return;
    }
    this.inFlight = true;
    if (!this.started && this.startTimer === undefined)
      this.startTimer = setTimeout(() => this.fail("the particle worker didn't answer"), START_TIMEOUT_MS);
    // Place the canvases with the transform this frame is drawn with.
    this.placement.place(view);
    this.optionsDirty = false;
    this.resetPending = false;
    this.sentSnap = f.snap;
    this.sentLabels = labels;
    this.sentObstacles = obstacles;
    this.sentSlow = f.slow;
    this.sentSlowRevision = slowRevision;
    this.sentViewKey = viewKey;
    this.sentFocus = f.focus;
    this.sentSpeed = f.speed;
    this.sentMarchPhase = f.march;
    this.glowPending = null;
    this.workerAnimating = false;
  }

  hitTest(x: number, y: number, radius?: number): number | undefined {
    return hitTestPoints(this.hits, x, y, radius);
  }

  probe(layer: Layer, rect: { x: number; y: number; width: number; height: number }): Promise<ProbeResult> {
    const host = this.host;
    const el = layer === "over" ? this.setup.overlay : layer === "march" ? (host?.march ?? null) : this.setup.canvas;
    if (!el || !host) return Promise.resolve(NO_PIXELS);
    const r = deviceRect(el, this.scene.dpr(), rect);
    const id = ++this.probeId;
    return new Promise((resolve) => {
      this.probes.set(id, (data) => resolve(probeResult(data, r)));
      const msg: ToWorker = { type: "probe", id, layer, ...r };
      host.worker.postMessage(msg);
    });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.startTimer);
    this.scene.dispose();
    for (const resolve of this.probes.values()) resolve(new Uint8ClampedArray());
    this.probes.clear();
    this.setup.root.removeAttribute(MARCH_ATTR);
    this.setup.root.removeAttribute(GLOW_ATTR);
    if (this.host) releaseHost(this.setup.canvas, this.host);
  }
}
