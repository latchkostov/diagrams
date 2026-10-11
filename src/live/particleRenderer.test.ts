import { afterEach, describe, expect, it, vi } from "vitest";
import type { Particle, SimSnapshot } from "../sim/types";
import type { PathLike } from "./pathSampler";
import { DEFAULT_TOKENS, ParticleRenderer, deviceRects, insideAny, type RenderEnv } from "./particleRenderer";

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
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { createElement: () => fakeCanvas({}) });
  let d = "M0 0 L200 0";
  const path: PathLike = {
    getAttribute: () => d,
    getTotalLength: () => 200,
    getPointAtLength: (l) => ({ x: l, y: 0 }),
    isConnected: true,
  };
  let transform: [number, number, number] = [0, 100, 1];
  const env: RenderEnv = {
    transform: () => transform,
    size: () => ({ width: 400, height: 300 }),
    edgePath: () => path,
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
    main,
    over,
    pan: () => (transform = [10, 100, 1]),
    movePath: () => (d = "M0 0 L200 10"),
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
