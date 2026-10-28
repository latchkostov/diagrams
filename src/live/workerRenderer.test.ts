// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Particle } from "../sim/types";
import { DEFAULT_TOKENS } from "./particleRenderer";
import type { FromWorker } from "./renderProtocol";

// The worker path's lifecycle through the real facade, with a stubbed Worker: every way the worker
// can fail to start or die hands over to the main thread (onFail) instead of throwing, and only a
// frame's own acknowledgement releases the next frame.

type Mode = "ok" | "throw-constructor" | "throw-post";
let mode: Mode;
let workers: FakeWorker[];

class FakeWorker {
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: { type: string; epoch?: number }[] = [];
  terminated = false;
  constructor() {
    if (mode === "throw-constructor") throw new DOMException("Blocked by CSP", "SecurityError");
    workers.push(this);
  }
  postMessage(m: { type: string; epoch?: number }) {
    if (mode === "throw-post") throw new DOMException("Could not clone", "DataCloneError");
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  /** The worker answers. */
  send(data: FromWorker) {
    this.onmessage?.({ data });
  }
}

function canvas(transfer: "ok" | "throw" = "ok") {
  return {
    style: {},
    hidden: false,
    dataset: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    transferControlToOffscreen: () => {
      if (transfer === "throw") throw new DOMException("Already transferred", "InvalidStateError");
      return {};
    },
  } as unknown as HTMLCanvasElement;
}

const store = {
  getState: () => ({
    transform: [0, 0, 1] as [number, number, number],
    width: 800,
    height: 600,
    nodes: [],
    nodeLookup: new Map(),
  }),
};

const particle: Particle = {
  id: 1,
  edgeId: "e1",
  messageId: 1,
  rootId: 1,
  kind: "message",
  progress: 0.5,
  type: "T",
  color: "#123456",
};

async function start(transfer: "ok" | "throw" = "ok") {
  const { createLiveRenderer } = await import("./liveRenderer");
  return startWith(createLiveRenderer, transfer);
}

function startWith(
  createLiveRenderer: typeof import("./liveRenderer").createLiveRenderer,
  transfer: "ok" | "throw" = "ok",
) {
  const onFail = vi.fn();
  const base = canvas(transfer);
  const overlay = canvas();
  const root = document.createElement("div");
  const labelRects: readonly [] = [];
  const renderer = createLiveRenderer("worker", {
    canvas: base,
    overlay,
    root,
    store,
    labelRects: () => labelRects,
    options: { theme: "light", reducedMotion: false, scale: 1, tokens: DEFAULT_TOKENS },
    onFail,
  });
  return { renderer, onFail, base, overlay, root };
}

const frame = (time: number) => ({
  snap: { particles: [{ ...particle, progress: time }], nodes: {} },
  now: time,
  speed: 1,
  march: 0,
});
const frames = (w: FakeWorker) => w.posted.filter((m) => m.type === "frame");

beforeEach(() => {
  vi.resetModules();
  mode = "ok";
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe("worker startup failures hand over to the main thread", () => {
  it("a Worker constructor that throws (CSP, disabled workers)", async () => {
    mode = "throw-constructor";
    const { createLiveRenderer } = await import("./liveRenderer");
    let started: ReturnType<typeof startWith> | undefined;
    expect(() => (started = startWith(createLiveRenderer))).not.toThrow();
    const { renderer, onFail } = started!;
    expect(onFail).not.toHaveBeenCalled(); // after the effect finishes setting up
    await Promise.resolve();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0][0]).toMatch(/couldn't start.*Blocked by CSP/);
    // Inert afterwards, and the next session goes straight to the fallback.
    expect(() => renderer.frame(frame(0.1))).not.toThrow();
    const { pickRenderer } = await import("./liveRenderer");
    vi.stubGlobal("OffscreenCanvas", function OffscreenCanvas() {});
    expect(pickRenderer("")).toBe("main");
  });

  it("a canvas transfer that throws: the half-started worker is terminated", async () => {
    const { onFail } = await start("throw");
    await Promise.resolve();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
  });

  it("an init message that can't be posted", async () => {
    mode = "throw-post";
    const { onFail } = await start();
    await Promise.resolve();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(workers[0].terminated).toBe(true);
  });

  it("a script that fails to load (error event)", async () => {
    const { onFail } = await start();
    workers[0].onerror?.({ message: "", preventDefault() {} });
    expect(onFail).toHaveBeenCalledWith("the particle worker failed to load");
  });

  it("a message that can't be deserialized (messageerror)", async () => {
    const { onFail } = await start();
    workers[0].onmessageerror?.();
    expect(onFail.mock.calls[0][0]).toMatch(/couldn't be read/);
  });

  it("a drawing error reported by the worker", async () => {
    const { onFail } = await start();
    workers[0].send({ type: "error", message: "boom" });
    expect(onFail).toHaveBeenCalledWith("boom");
  });

  it("a worker that never answers", async () => {
    vi.useFakeTimers();
    try {
      const { renderer, onFail } = await start();
      renderer.frame(frame(0.1));
      vi.advanceTimersByTime(10_001);
      expect(onFail.mock.calls[0][0]).toMatch(/didn't answer/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails once, and not at all once disposed", async () => {
    const { renderer, onFail } = await start();
    renderer.dispose();
    workers[0].send({ type: "error", message: "late" });
    workers[0].onmessageerror?.();
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe("frame flow control", () => {
  it.each(["data-detail-wrapped", "data-detail-expanded"])(
    "keeps stale labels hidden until a frame acknowledges the current card geometry (%s)",
    async (attribute) => {
      const { renderer, base, overlay, root } = await start();
      let revision = 0;
      const resize = () => {
        root.setAttribute(attribute, String(++revision));
        renderer.tick();
      };
      const w = workers[0];
      const label = {
        id: 1,
        text: "Request",
        count: 1,
        x: 10,
        y: 10,
        w: 60,
        h: 20,
        ax: 0,
        ay: 0,
        leader: false,
        spot: 0,
      };
      renderer.frame(frame(0.1));
      const epoch = frames(w)[0].epoch!;
      w.send({ type: "ack", epoch, drawn: 1, frames: 1, animating: false, labels: [label] });
      expect(renderer.labels).toEqual([label]);
      expect(overlay.hidden).toBe(false);
      base.dataset.traceLabels = "previous geometry";
      renderer.frame(frame(0.2));
      resize();
      expect(overlay.hidden).toBe(true);
      expect(renderer.labels).toEqual([]);
      expect(base.dataset.traceLabels).toBeUndefined();
      w.send({ type: "repaint", epoch, drawn: 1, frames: 3, labels: [label] });
      expect(overlay.hidden).toBe(true);
      w.send({ type: "ack", epoch, drawn: 1, frames: 2, animating: false, labels: [label] });
      expect(overlay.hidden).toBe(true);
      expect(renderer.labels).toEqual([]);
      renderer.frame(frame(0.3));
      w.send({ type: "ack", epoch, drawn: 1, frames: 4, animating: false, labels: [label] });
      expect(overlay.hidden).toBe(false);
      expect(renderer.labels).toEqual([label]);
      resize();
      renderer.dispose();
      expect(overlay.hidden).toBe(false);
    },
  );

  it("posts an unchanged paused frame to acknowledge detail geometry before revealing labels", async () => {
    const { renderer, overlay, root } = await start();
    const w = workers[0];
    const paused = frame(0.1);
    renderer.frame(paused);
    const epoch = frames(w)[0].epoch!;
    w.send({ type: "ack", epoch, drawn: 1, frames: 1, animating: false });
    expect(overlay.hidden).toBe(false);
    root.setAttribute("data-detail-wrapped", "");
    renderer.tick();
    expect(overlay.hidden).toBe(true);
    renderer.frame(paused);
    expect(frames(w)).toHaveLength(2);
    // A newer geometry revision supersedes the one in flight.
    root.setAttribute("data-detail-expanded", "");
    renderer.tick();
    w.send({ type: "ack", epoch, drawn: 1, frames: 2, animating: false });
    expect(overlay.hidden).toBe(true);
    renderer.frame(paused);
    expect(frames(w)).toHaveLength(3);
    w.send({ type: "ack", epoch, drawn: 1, frames: 3, animating: false });
    expect(overlay.hidden).toBe(false);
    renderer.frame(paused);
    expect(frames(w)).toHaveLength(3);
    renderer.dispose();
  });

  it("keeps one frame in flight: a repaint doesn't release it, its ack does", async () => {
    const { renderer } = await start();
    const w = workers[0];
    renderer.frame(frame(0.1));
    expect(frames(w)).toHaveLength(1);
    const epoch = frames(w)[0].epoch!;
    renderer.frame(frame(0.2));
    expect(frames(w)).toHaveLength(1);
    // Fonts loaded: the worker repainted on its own and reports counts.
    w.send({ type: "repaint", epoch, drawn: 3, frames: 2 });
    expect(renderer.drawn).toBe(3);
    renderer.frame(frame(0.3));
    expect(frames(w)).toHaveLength(1);
    w.send({ type: "ack", epoch, drawn: 3, frames: 2, animating: false });
    renderer.frame(frame(0.4));
    expect(frames(w)).toHaveLength(2);
  });

  it("asks for an edge's samples once particles ride it", async () => {
    const { renderer } = await start();
    renderer.frame(frame(0.1));
    const first = workers[0].posted.find((m) => m.type === "frame") as unknown as { dict?: { edges?: string[] } };
    expect(first.dict?.edges).toEqual(["e1"]);
  });
});
