import { loadCanvasFonts } from "./canvasFonts";
import { LiveScene } from "./liveScene";
import { MarchRenderer, type MarchEdge } from "./marchRenderer";
import { ParticleRenderer, type RenderOptions } from "./particleRenderer";
import type { PaintedLabel, SlowOverlay } from "./slowmo/overlay";
import type { PlacedLabel } from "./traceLabels";
import type { Layer } from "./renderProtocol";
import type { FrameInput, LiveRenderer, ProbeResult, RendererSetup } from "./liveRenderer";
import {
  CanvasPlacement,
  mountMarchCanvas,
  MARCH_ATTR,
  keepLast,
  viewOf,
  deviceRect,
  probeResult,
  NO_PIXELS,
  TEST_HOOKS,
} from "./rendererShared";
// ------------------------------------------------------------------ main thread (fallback)

export class MainThreadRenderer implements LiveRenderer {
  #setup: RendererSetup;

  readonly kind = "main";
  #scene: LiveScene;
  #core: ParticleRenderer;
  #placement: CanvasPlacement;
  #slow: SlowOverlay | undefined;
  #marchCanvas: HTMLCanvasElement | null;
  #march: MarchRenderer | null = null;
  #marchEdges: readonly MarchEdge[] | null = null;
  #reduced: boolean;

  constructor(setup: RendererSetup) {
    this.#setup = setup;

    void loadCanvasFonts(document.fonts)
      .then(() => this.#core.invalidate())
      .catch(() => {});
    this.#scene = new LiveScene(setup.root, setup.store, () => {
      setup.overlay.hidden = true;
      delete setup.canvas.dataset.traceLabels;
    });
    const scene = this.#scene;
    this.#reduced = setup.options.reducedMotion;
    this.#marchCanvas = mountMarchCanvas(setup.root);
    if (this.#marchCanvas) {
      this.#march = new MarchRenderer(this.#marchCanvas);
      setup.root.setAttribute(MARCH_ATTR, "canvas");
    }
    this.#placement = new CanvasPlacement([setup.canvas, setup.overlay, this.#marchCanvas]);
    this.#core = new ParticleRenderer(
      setup.canvas,
      {
        transform: () => scene.transform(),
        size: () => scene.size(),
        dpr: () => scene.dpr(),
        samples: (id) => scene.samples(id),
        pathsVersion: () => scene.pathsVersion,
        edgeInk: (id) => scene.ink.get(id),
        nodeRect: (id) => scene.nodeRect(id),
        obstacles: () => scene.obstacles(),
        labelRects: () => setup.labelRects(),
      },
      setup.options,
      setup.overlay,
    );
  }

  setOptions(opts: RenderOptions): void {
    this.#reduced = opts.reducedMotion;
    this.#core.setOptions(opts);
  }
  reset(): void {
    this.#core.reset();
  }
  frame(f: FrameInput): void {
    this.#scene.refresh();
    const view = viewOf(this.#scene);
    this.#placement.place(view);
    this.#slow = f.slow;
    this.#core.draw(f.snap, f.now, f.focus, f.slow, f.speed);
    this.#setup.overlay.hidden = false;
    if (this.#march) {
      if (this.#scene.march !== this.#marchEdges) this.#march.setEdges((this.#marchEdges = this.#scene.march));
      this.#march.draw(view, f.march, this.#reduced);
    }
  }
  tick(): void {
    this.#scene.refresh();
    keepLast(this.#marchCanvas, this.#setup.root);
  }
  hitTest(x: number, y: number, radius?: number): number | undefined {
    return this.#core.hitTest(x, y, radius);
  }
  get drawn(): number {
    return this.#core.drawn;
  }
  get frames(): number {
    return this.#core.frames;
  }
  get labels(): readonly PlacedLabel[] {
    return this.#setup.overlay.hidden ? [] : this.#core.labels;
  }
  get slowLabels(): readonly PaintedLabel[] {
    return this.#setup.overlay.hidden ? [] : (this.#slow?.labels ?? []);
  }
  probe(layer: Layer, rect: { x: number; y: number; width: number; height: number }): Promise<ProbeResult> {
    if (!TEST_HOOKS) return Promise.resolve(NO_PIXELS);
    const el = layer === "over" ? this.#setup.overlay : layer === "march" ? this.#marchCanvas : this.#setup.canvas;
    if (!el) return Promise.resolve(NO_PIXELS);
    const r = deviceRect(el, this.#scene.dpr(), rect);
    const data = el.getContext("2d")?.getImageData(r.x, r.y, r.w, r.h).data;
    return Promise.resolve(data ? probeResult(data, r) : NO_PIXELS);
  }
  dispose(): void {
    this.#scene.dispose();
    this.#setup.overlay.hidden = false;
    this.#marchCanvas?.remove();
    this.#setup.root.removeAttribute(MARCH_ATTR);
  }
}
