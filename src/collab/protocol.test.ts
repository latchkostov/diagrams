import { describe, expect, it } from "vitest";
import { FakeClock } from "./clock";
import { COLLAB_LIMITS } from "./limits";
import { DOC, fragment, frame, Reassembler, unframe } from "./protocol";
import { seededBytes } from "./random";

const SIZE = COLLAB_LIMITS.maxFragmentBytes;
const message = (n: number) => frame(DOC.syncReply, seededBytes(n)(n - 1));
const payloads = (m: Uint8Array, id = 1) => fragment(m, id).map((f) => unframe(f)!.payload);

describe("fragments", () => {
  it("splits a large message into full-size parts and puts it back together, in any order", () => {
    const m = message(SIZE * 2 + 17);
    const parts = fragment(m, 7);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.length <= SIZE + 13)).toBe(true);
    const r = new Reassembler(new FakeClock());
    const [p0, p1, p2] = parts.map((p) => unframe(p)!.payload);
    expect(r.add("s", p2)).toEqual({ pending: true });
    expect(r.add("s", p0)).toEqual({ pending: true });
    const done = r.add("s", p1);
    expect("done" in done && done.done).toEqual(m);
    expect(r.pending).toBe(0);
  });

  it("keeps two senders' messages with the same id apart", () => {
    const r = new Reassembler(new FakeClock());
    const [a, b] = [message(SIZE + 5), message(SIZE + 9)];
    const [pa, pb] = [payloads(a), payloads(b)];
    r.add("x", pa[0]);
    r.add("y", pb[0]);
    expect(r.add("y", pb[1])).toEqual({ done: b });
    expect(r.add("x", pa[1])).toEqual({ done: a });
  });

  const tamper = (edit: (v: DataView, body: Uint8Array) => unknown) => {
    const p = payloads(message(SIZE * 2 + 1))[0].slice();
    const out = edit(new DataView(p.buffer), p);
    return out instanceof Uint8Array ? out : p;
  };

  it.each([
    ["a short header", () => new Uint8Array(5), "malformed"],
    [
      "a length past the message bound",
      () => tamper((v) => v.setUint32(8, COLLAB_LIMITS.maxMessageBytes + 1)),
      "too-large",
    ],
    [
      "a message that would have fitted one frame",
      () => tamper((v) => (v.setUint32(8, SIZE), v.setUint16(6, 1))),
      "malformed",
    ],
    ["a count that doesn't follow from the length", () => tamper((v) => v.setUint16(6, 9)), "malformed"],
    ["an index past the count", () => tamper((v) => v.setUint16(4, 3)), "malformed"],
    ["a part of the wrong size", () => tamper((_v, p) => p.subarray(0, p.length - 1)), "malformed"],
  ])("refuses %s", (_name, make, error) => {
    expect(new Reassembler(new FakeClock()).add("s", make())).toEqual({ error });
  });

  it("refuses a repeated part, and a part that disagrees with the message's first", () => {
    const r = new Reassembler(new FakeClock());
    const [p0] = payloads(message(SIZE * 2 + 1));
    r.add("s", p0);
    expect(r.add("s", p0)).toEqual({ error: "malformed" });
    const other = payloads(message(SIZE * 3 + 1));
    r.add("s", payloads(message(SIZE * 2 + 1))[0]);
    expect(r.add("s", other[1])).toEqual({ error: "malformed" });
  });

  it("bounds half-delivered messages per sender, and expires them on the room clock", () => {
    const clock = new FakeClock();
    const r = new Reassembler(clock);
    for (let id = 1; id <= COLLAB_LIMITS.maxPartialMessages; id++)
      expect(r.add("s", payloads(message(SIZE + 3), id)[0])).toEqual({ pending: true });
    expect(r.add("s", payloads(message(SIZE + 3), 99)[0])).toEqual({ error: "too-many-partials" });
    expect(r.add("other", payloads(message(SIZE + 3), 99)[0])).toEqual({ pending: true });
    clock.advance(COLLAB_LIMITS.partialTtlMs + 1);
    expect(r.add("s", payloads(message(SIZE + 3), 100)[0])).toEqual({ pending: true });
    expect(r.pending).toBe(1);
  });
});
