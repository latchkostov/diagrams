import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Particle } from "../sim/types";
import { DEFAULT_TOKENS } from "./particleRenderer";
import { SnapshotPacker, type AckMessage, type FrameMessage, type FromWorker, type ToWorker } from "./renderProtocol";

const fonts = vi.hoisted(() => ({ load: vi.fn<() => Promise<void>>() }));
vi.mock("./canvasFonts", () => ({ loadCanvasFonts: fonts.load }));

// The worker module, driven through its message handler with recording canvases: what the main
// thread posts is what gets drawn, and the acks carry back what the live view reads.

type Calls = Record<string, number>;

function fakeCanvas(calls: Calls) {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "measureText") return () => ({ width: 10 });
      if (key === "getImageData")
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(7) });
      return () => {
        calls[key] = (calls[key] ?? 0) + 1;
      };
    },
    set(t, key: string, value) {
      t[key] = value;
      return true;
    },
  });
  return { width: 0, height: 0, getContext: () => ctx } as unknown as OffscreenCanvas;
}

const particle = (id: number, progress: number): Particle => ({
  id,
  edgeId: "e1",
  messageId: id * 10,
  rootId: id,
  kind: "message",
  progress,
  type: "OrderPlaced",
  color: "#e06a2c",
});

let scope: { onmessage: ((e: { data: ToWorker }) => void) | null; postMessage: (m: FromWorker) => void };
let posted: FromWorker[];
let base: Calls;
const send = (data: ToWorker) => scope.onmessage!({ data });
const lastAck = () => posted.filter((m): m is AckMessage => m.type === "ack").at(-1)!;

const frame = (over: Partial<FrameMessage>): FrameMessage => ({
  type: "frame",
  epoch: 1,
  view: { x: 0, y: 100, zoom: 1, width: 400, height: 300, dpr: 1 },
  now: 0,
  speed: 1,
  slow: null,
  marchPhase: 0,
  ...over,
});

beforeEach(async () => {
  vi.resetModules();
  fonts.load.mockImplementation(() => new Promise(() => {}));
  posted = [];
  base = {};
  scope = { onmessage: null, postMessage: (m) => posted.push(m) };
  vi.stubGlobal("self", scope);
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        return Object.assign(fakeCanvas({}), { width, height });
      }
    },
  );
  await import("./particleWorker");
  send({ type: "init", canvas: fakeCanvas(base), overlay: fakeCanvas({}) });
});

afterEach(() => vi.unstubAllGlobals());

describe("the particle worker", () => {
  it("defers late font drawing until the main loop supplies a visible frame", async () => {
    let ready!: () => void;
    fonts.load.mockImplementation(() => new Promise<void>((resolve) => (ready = resolve)));
    send({ type: "init", canvas: fakeCanvas(base), overlay: fakeCanvas({}) });
    send(frame({ sync: true }));
    const draws = base.clearRect;
    const count = lastAck().frames;
    ready();
    await Promise.resolve();
    expect(posted.at(-1)).toEqual({ type: "invalidate", epoch: 1 });
    expect(base.clearRect).toBe(draws);
    expect(lastAck().frames).toBe(count);
    // A hidden loop supplies no frames. Returning to the drawing uses the current view, not last's.
    send(frame({ view: { x: 50, y: 100, zoom: 1, width: 400, height: 300, dpr: 1 } }));
    expect(lastAck().frames).toBe(count + 1);
  });

  it("draws the posted particles along the posted paths and acks with hits and counts", () => {
    const packer = new SnapshotPacker();
    const snap = packer.pack({ particles: [particle(1, 0.25)], nodes: {} });
    const points = new Float32Array([0, 0, 200, 0]);
    send(
      frame({
        sync: true,
        options: { theme: "light", reducedMotion: false, scale: 1, tokens: DEFAULT_TOKENS },
        dict: packer.takeDict(),
        paths: { set: [["e1", 200, points]], remove: [] },
        labels: [],
        obstacles: null,
        snap,
      }),
    );
    const ack = lastAck();
    expect(ack).toMatchObject({ type: "ack", epoch: 1, drawn: 1, frames: 1, animating: false });
    // The buffer goes back for reuse; the hit target is the dot (x 50 on the edge, y 0 + 100).
    expect(ack.buf).toBe(snap.buf);
    expect([...ack.hits!]).toEqual([50, 100, 10]);
    expect(base.drawImage).toBe(1);
  });

  it("skips a frame with nothing new and sends back only what changed", () => {
    const packer = new SnapshotPacker();
    const snap = packer.pack({ particles: [particle(1, 0.25)], nodes: {} });
    send(
      frame({
        sync: true,
        dict: packer.takeDict(),
        paths: { set: [["e1", 200, new Float32Array([0, 0, 200, 0])]], remove: [] },
        snap,
      }),
    );
    const draws = base.drawImage;
    send(frame({ now: 16 })); // paused: no snapshot, same view
    const ack = lastAck();
    expect(base.drawImage).toBe(draws);
    expect(ack.frames).toBe(1);
    expect(ack.hits).toBeUndefined();
    expect(ack.buf).toBeUndefined();
    send(frame({ now: 32, view: { x: 10, y: 100, zoom: 1, width: 400, height: 300, dpr: 1 } })); // panned
    expect(base.drawImage).toBe(draws + 1);
    expect([...lastAck().hits!]).toEqual([60, 100, 10]);
  });

  it("a sync drops every table, path and box", () => {
    const packer = new SnapshotPacker();
    const first = packer.pack({ particles: [particle(1, 0.5)], nodes: {} });
    send(
      frame({
        sync: true,
        dict: packer.takeDict(),
        paths: { set: [["e1", 200, new Float32Array([0, 0, 200, 0])]], remove: [] },
        snap: first,
      }),
    );
    expect(lastAck().drawn).toBe(1);
    // A new attachment that hasn't sent paths yet: the particle has nowhere to go.
    const fresh = new SnapshotPacker();
    const snap = fresh.pack({ particles: [particle(2, 0.5)], nodes: {} });
    send(frame({ epoch: 2, sync: true, dict: fresh.takeDict(), snap }));
    expect(lastAck()).toMatchObject({ epoch: 2, drawn: 0 });
  });

  it("answers a probe with the layer's pixels", () => {
    send({ type: "probe", id: 9, layer: "base", x: 0, y: 0, w: 2, h: 1 });
    const reply = posted.at(-1) as Extract<FromWorker, { type: "probe" }>;
    expect(reply.id).toBe(9);
    expect([...reply.data]).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
  });

  it("reports a drawing failure instead of dying silently", () => {
    const packer = new SnapshotPacker();
    const snap = packer.pack({ particles: [particle(1, 0.5)], nodes: {} });
    // A path without points: drawing on it throws.
    send(
      frame({ sync: true, dict: packer.takeDict(), paths: { set: [["e1", 200, null as never]], remove: [] }, snap }),
    );
    expect(posted.at(-1)).toMatchObject({ type: "error" });
  });
});
