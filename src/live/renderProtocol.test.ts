import { describe, expect, it } from "vitest";
import type { Particle } from "../sim/types";
import type { RenderSnapshot } from "./particleRenderer";
import { SnapshotPacker, SnapshotUnpacker, STRIDE, postablePaths } from "./renderProtocol";

const particle = (over: Partial<Particle> & { id: number }): Particle => ({
  edgeId: "a-to-b",
  messageId: over.id,
  rootId: over.id,
  kind: "message",
  progress: 0.5,
  type: "OrderPlaced",
  color: "#e06a2c",
  ...over,
});

const snap = (particles: Particle[], nodes: RenderSnapshot["nodes"] = {}): RenderSnapshot => ({ particles, nodes });

/** Packs on the "main thread" and unpacks on the "worker", as a frame message would carry it. */
function roundTrip(packer: SnapshotPacker, unpacker: SnapshotUnpacker, s: RenderSnapshot) {
  const packed = packer.pack(s);
  const dict = packer.takeDict();
  // A structured clone of the message: the buffer is transferred, the strings copied.
  unpacker.apply(structuredClone(dict));
  return { out: unpacker.unpack(packed), dict, packed };
}

describe("particle packing", () => {
  it("round-trips every field a particle carries, and the failure counts per node", () => {
    const packer = new SnapshotPacker();
    const unpacker = new SnapshotUnpacker();
    const ps = [
      particle({ id: 1, progress: 0 }),
      particle({ id: 2, edgeId: "b-to-c", kind: "reply", progress: 1, rootId: 1 }),
      particle({ id: 3, kind: "retry", type: "PaymentFailed", color: "#d99000", progress: 0.333 }),
      particle({ id: 2_000_000_123, messageId: 2_000_000_124, rootId: 7, kind: "dlq", progress: 0.9 }),
    ];
    const nodes = {
      a: { failed: 1, deadLettered: 2, dropped: 3 },
      b: { failed: 0, deadLettered: 0, dropped: 0 },
    };
    const { out } = roundTrip(packer, unpacker, snap(ps, nodes));
    expect(out.particles).toHaveLength(4);
    out.particles.forEach((p, i) => {
      const want = ps[i];
      expect({ ...p, progress: 0 }).toEqual({ ...want, progress: 0 });
      // float32: a few parts in ten million, far below a device pixel on any edge.
      expect(p.progress).toBeCloseTo(want.progress, 6);
    });
    expect(out.nodes).toEqual({
      a: { failed: 6, deadLettered: 0, dropped: 0 },
      b: { failed: 0, deadLettered: 0, dropped: 0 },
    });
  });

  it("sends each string once, the first time it's used", () => {
    const packer = new SnapshotPacker();
    const unpacker = new SnapshotUnpacker();
    const first = roundTrip(
      packer,
      unpacker,
      snap([particle({ id: 1 }), particle({ id: 2 })], { a: { failed: 0, deadLettered: 0, dropped: 0 } }),
    );
    expect(first.dict).toEqual({ edges: ["a-to-b"], nodes: ["a"], styles: [["OrderPlaced", "#e06a2c"]] });
    const again = roundTrip(
      packer,
      unpacker,
      snap([particle({ id: 3 })], { a: { failed: 1, deadLettered: 0, dropped: 0 } }),
    );
    expect(again.dict).toBeUndefined();
    const more = roundTrip(packer, unpacker, snap([particle({ id: 4, edgeId: "b-to-c", color: "#123456" })]));
    expect(more.dict).toEqual({ edges: ["b-to-c"], styles: [["OrderPlaced", "#123456"]] });
    expect(more.out.particles[0]).toMatchObject({ edgeId: "b-to-c", color: "#123456", type: "OrderPlaced" });
  });

  it("packs 6 int32 slots per particle and reuses buffers the worker hands back", () => {
    const packer = new SnapshotPacker();
    const many = Array.from({ length: 1500 }, (_, i) => particle({ id: i + 1, progress: (i % 100) / 100 }));
    const a = packer.pack(snap(many));
    expect(a.buf.byteLength).toBeGreaterThanOrEqual((2 + many.length * STRIDE) * 4);
    packer.recycle(a.buf);
    const b = packer.pack(snap(many.slice(0, 10)));
    expect(b.buf).toBe(a.buf);
    // Too small a buffer in the pool isn't used.
    packer.recycle(new ArrayBuffer(16));
    const c = packer.pack(snap(many));
    expect(c.buf.byteLength).toBeGreaterThanOrEqual((2 + many.length * STRIDE) * 4);
  });

  it("starts over after a clear: the worker's tables were dropped too", () => {
    const packer = new SnapshotPacker();
    roundTrip(packer, new SnapshotUnpacker(), snap([particle({ id: 1 })]));
    packer.clear();
    const fresh = new SnapshotUnpacker();
    const { dict, out } = roundTrip(packer, fresh, snap([particle({ id: 2 })]));
    expect(dict?.edges).toEqual(["a-to-b"]);
    expect(out.particles[0].edgeId).toBe("a-to-b");
  });

  it("gives the renderer a new snapshot object per frame (it compares identity)", () => {
    const packer = new SnapshotPacker();
    const unpacker = new SnapshotUnpacker();
    const one = roundTrip(packer, unpacker, snap([particle({ id: 1 })])).out;
    const two = roundTrip(packer, unpacker, snap([particle({ id: 1, progress: 0.6 })])).out;
    expect(two).not.toBe(one);
    expect(two.particles[0].progress).toBeCloseTo(0.6, 6);
  });
});

describe("path posting", () => {
  it("copies samples so the main thread keeps its own", () => {
    const points = new Float32Array([0, 0, 10, 0]);
    const [[id, length, copy]] = postablePaths([["e1", { length: 10, points }]]);
    expect([id, length]).toEqual(["e1", 10]);
    expect(copy).toEqual(points);
    expect(copy).not.toBe(points);
    expect(copy.buffer).not.toBe(points.buffer);
  });
});
