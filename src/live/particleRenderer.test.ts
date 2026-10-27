import { afterEach, describe, expect, it, vi } from "vitest";
import type { Particle, SimSnapshot } from "../sim/types";
import { samplePath, type PathSamples } from "./pathSampler";
import {
  DEFAULT_TOKENS,
  ParticleRenderer,
  deviceRects,
  hitTestPoints,
  insideAny,
  type RenderEnv,
} from "./particleRenderer";

describe("dots behind edge label pills", () => {
  it("maps label rects from flow to device px for the current view", () => {
    const out: number[] = [];
    // zoom 2 at dpr 1.5 (k = 3), viewport offset (30, 60) device px
    deviceRects([{ x: 10, y: 20, width: 40, height: 14 }], 3, 30, 60, out);
    expect(out).toEqual([60, 120, 180, 162]);
    // The output array is reused frame to frame.
    deviceRects([], 3, 30, 60, out);
    expect(out).toEqual([]);
  });

  it("finds a dot inside any pill, edges included, and nothing outside", () => {
    const rects = deviceRects(
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 100, y: 50, width: 20, height: 8 },
      ],
      1,
      0,
      0,
      [],
    );
    expect(insideAny(rects, 5, 5)).toBe(true);
    expect(insideAny(rects, 10, 10)).toBe(true);
    expect(insideAny(rects, 110, 54)).toBe(true);
    expect(insideAny(rects, 11, 5)).toBe(false);
    expect(insideAny(rects, 110, 59)).toBe(false);
    expect(insideAny([], 5, 5)).toBe(false);
  });
});

// ---------- the renderer, against recording 2D contexts (no DOM needed) ----------

type Calls = Record<string, number>;

function fakeContext(calls: Calls): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (..._args: unknown[]) => {
        calls[key] = (calls[key] ?? 0) + 1;
      };
    },
    set(t, key: string, value) {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(calls: Calls): HTMLCanvasElement {
  const ctx = fakeContext(calls);
  return { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

const particle = (id: number, progress: number): Particle => ({
  id,
  edgeId: "e1",
  messageId: id,
  rootId: id,
  kind: "message",
  progress,
  type: "OrderPlaced",
  color: "#e06a2c",
});

const snapshot = (particles: Particle[]): SimSnapshot => ({
  time: 0,
  particles,
  nodes: {},
  edges: {},
  events: [],
  inSystem: particles.length,
});

function setup() {
  vi.stubGlobal("document", { createElement: () => fakeCanvas({}) });
  // The scene hands the renderer sampled paths and a version that bumps when one changes.
  let samples: PathSamples = samplePath(200, (l) => ({ x: l, y: 0 }));
  let version = 1;
  let transform: [number, number, number] = [0, 100, 1];
  const env: RenderEnv = {
    transform: () => transform,
    size: () => ({ width: 400, height: 300 }),
    dpr: () => 1,
    samples: () => samples,
    pathsVersion: () => version,
    nodeRect: () => null,
    // One pill in the middle of the edge: x 90..110.
    labelRects: () => [{ x: 90, y: -7, width: 20, height: 14 }],
  };
  const main: Calls = {};
  const over: Calls = {};
  const opts = { theme: "light" as const, reducedMotion: false, scale: 1, tokens: DEFAULT_TOKENS };
  const renderer = new ParticleRenderer(fakeCanvas(main), env, opts, fakeCanvas(over));
  return {
    renderer,
    env,
    setZoom: (zoom: number) => {
      transform = [0, 100, zoom];
      version++;
    },
    main,
    over,
    pan: () => (transform = [10, 100, 1]),
    movePath: () => {
      samples = samplePath(200, (l) => ({ x: l, y: l / 20 }));
      version++;
    },
  };
}

describe("ParticleRenderer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("draws nothing again while paused, and redraws when anything changes", () => {
    const { renderer, main, pan, movePath } = setup();
    const paused = snapshot([particle(1, 0.2)]);
    renderer.draw(paused, 0);
    expect(main.clearRect).toBe(1);
    for (let i = 1; i < 10; i++) renderer.draw(paused, i * 16);
    expect(main.clearRect).toBe(1); // the same snapshot: the canvas already shows it
    renderer.draw(snapshot([particle(1, 0.25)]), 200); // playing again
    expect(main.clearRect).toBe(2);
    const still = snapshot([particle(1, 0.25)]);
    renderer.draw(still, 216);
    renderer.draw(still, 232);
    expect(main.clearRect).toBe(3);
    pan();
    renderer.draw(still, 248);
    expect(main.clearRect).toBe(4);
    movePath(); // a node moved while paused: the dots follow their edge
    renderer.draw(still, 264);
    expect(main.clearRect).toBe(5);
    renderer.draw(still, 280);
    expect(main.clearRect).toBe(5);
  });

  it("skips a paused slow motion's unchanged frames, and draws the one after it ends", () => {
    const { renderer, main } = setup();
    const frozen = snapshot([particle(1, 0.2)]);
    let paints = 0;
    const overlay = { backgroundAlpha: 0.12, revision: 0, paint: () => paints++ };
    for (let i = 0; i < 3; i++) {
      overlay.revision++; // playing: a new frame every time
      renderer.draw(frozen, i * 16, undefined, overlay);
    }
    expect(paints).toBe(3);
    for (let i = 3; i < 60; i++) renderer.draw(frozen, i * 16, undefined, overlay); // paused
    expect(paints).toBe(3);
    const cleared = main.clearRect;
    renderer.draw(frozen, 1000); // back to live: its drawings are cleared
    expect(main.clearRect).toBe(cleared + 1);
    renderer.draw(frozen, 1016);
    expect(main.clearRect).toBe(cleared + 1);
  });

  it("draws a dot behind a label pill dimmed on the overlay, others on the particle canvas", () => {
    const { renderer, main, over } = setup();
    renderer.draw(snapshot([particle(1, 0.2)]), 0); // x = 40: clear of the pill
    expect(main.drawImage).toBe(1);
    expect(over.arc ?? 0).toBe(0);
    renderer.draw(snapshot([particle(1, 0.5)]), 16); // x = 100: behind the pill
    expect(main.drawImage).toBe(1);
    expect(over.arc).toBe(1);
  });
});

describe("hit targets", () => {
  it("finds the nearest message within the radius, from x, y, id triples", () => {
    const hits = [10, 10, 1, 30, 10, 2, 100, 100, 3];
    expect(hitTestPoints(hits, 12, 10)).toBe(1);
    expect(hitTestPoints(hits, 24, 10)).toBe(2);
    expect(hitTestPoints(hits, 60, 60)).toBeUndefined();
    expect(hitTestPoints(Float64Array.from(hits), 99, 101)).toBe(3);
    expect(hitTestPoints([], 0, 0)).toBeUndefined();
  });

  it("are the drawn particles' positions in pane CSS px", () => {
    const { renderer } = setup();
    renderer.draw(snapshot([particle(7, 0.2)]), 0);
    // x = 40 along the edge, y = 0 + the viewport offset 100.
    expect([...renderer.hitPoints]).toEqual([expect.closeTo(40, 3), expect.closeTo(100, 3), 7]);
    expect(renderer.hitTest(41, 101)).toBe(7);
  });
});

describe("calm sampler and frame counts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("thins slow speeds by message family, and draws everything at 1x", () => {
    const { renderer } = setup();
    const many = snapshot(Array.from({ length: 200 }, (_, i) => particle(i + 1, (i % 100) / 100)));
    renderer.draw(many, 0, undefined, undefined, 1);
    const full = renderer.drawn;
    renderer.draw(snapshot([...many.particles]), 16, undefined, undefined, 0.25);
    expect(renderer.drawn).toBeLessThan(full);
    renderer.draw(snapshot([...many.particles]), 32, undefined, undefined, 1);
    expect(renderer.drawn).toBe(full);
  });

  it("repaints the same paused snapshot when the speed changes", () => {
    // Paused, the controller hands back one snapshot for good: only the speed changes.
    const { renderer, main } = setup();
    const paused = snapshot(Array.from({ length: 200 }, (_, i) => particle(i + 1, (i % 100) / 100)));
    renderer.draw(paused, 0, undefined, undefined, 1);
    const full = renderer.drawn;
    const fullHits = renderer.hitPoints.length;
    renderer.draw(paused, 16, undefined, undefined, 0.25);
    expect(renderer.drawn).toBeLessThan(full);
    expect(renderer.hitPoints.length).toBeLessThan(fullHits);
    renderer.draw(paused, 32, undefined, undefined, 1);
    expect(renderer.drawn).toBe(full);
    expect(renderer.hitPoints.length).toBe(fullHits);
    // Nothing else changes: the next frame is skipped.
    const clears = main.clearRect;
    renderer.draw(paused, 48, undefined, undefined, 1);
    expect(main.clearRect).toBe(clears);
  });

  it("counts painted frames only", () => {
    const { renderer } = setup();
    const paused = snapshot([particle(1, 0.2)]);
    renderer.draw(paused, 0);
    renderer.draw(paused, 16);
    renderer.draw(paused, 32);
    expect(renderer.frames).toBe(1);
    renderer.draw(snapshot([particle(1, 0.3)]), 48);
    expect(renderer.frames).toBe(2);
  });
});

it("frame ink suppresses hidden and far background particles on both render paths", () => {
  const { renderer, env, setZoom } = setup();
  const paused = snapshot([particle(1, 0.2)]);
  env.edgeInk = () => ({ alpha: 0, near: true });
  renderer.draw(paused, 0);
  expect(renderer.drawn).toBe(0);
  env.edgeInk = () => ({ alpha: 0.28, near: false });
  setZoom(0.4);
  renderer.draw(paused, 1);
  expect(renderer.drawn).toBe(0);
  env.edgeInk = () => ({ alpha: 1, near: true });
  renderer.invalidate();
  renderer.draw(paused, 2);
  expect(renderer.drawn).toBe(1);
  vi.unstubAllGlobals();
});
