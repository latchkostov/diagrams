import { describe, expect, it } from "vitest";
import {
  clientFrame,
  readClientFrame,
  serverFrame,
  readServerFrame,
  parseControl,
  parseHello,
  RELAY_LIMITS,
} from "./relayProtocol";

describe("relay v1 wire contract", () => {
  const peer = "0123456789abcdef";
  it("encodes exactly the broadcast, addressed and server prefixes", () => {
    const bytes = new Uint8Array([20, 30]);
    expect([...clientFrame(bytes)]).toEqual([0, 20, 30]);
    expect([...clientFrame(bytes, peer)]).toEqual([1, 1, 35, 69, 103, 137, 171, 205, 239, 20, 30]);
    expect([...serverFrame(bytes, peer)]).toEqual([0, 1, 35, 69, 103, 137, 171, 205, 239, 20, 30]);
    expect(readClientFrame(clientFrame(bytes, peer))).toEqual({ to: peer, envelope: bytes });
  });
  it("gives each receiver its own envelope bytes", () => {
    const wire = serverFrame(new Uint8Array([20, 30]), peer);
    const received = readServerFrame(wire)!;
    wire.fill(0);
    expect(received.from).toBe(peer);
    expect([...received.envelope]).toEqual([20, 30]);
  });
  it.each([[], [0], [1, 0], [2, 1], Array(9).fill(1)].map((bytes) => ({ bytes })))(
    "rejects malformed client framing $bytes",
    ({ bytes }) => {
      expect(readClientFrame(new Uint8Array(bytes))).toBeUndefined();
    },
  );
  it("validates control metadata before allocating peer state", () => {
    const welcome = {
      t: "welcome",
      self: peer,
      peers: [],
      cap: 8,
      maxFrame: RELAY_LIMITS.maxFrameBytes,
      durable: false,
    };
    expect(parseControl(JSON.stringify(welcome))).toEqual(welcome);
    for (const bad of [
      { durable: true },
      { cap: 0 },
      { maxFrame: RELAY_LIMITS.maxFrameBytes + 1 },
      { peers: [peer] },
      { peers: ["fedcba9876543210", "fedcba9876543210"] },
    ])
      expect(parseControl(JSON.stringify({ ...welcome, ...bad }))).toBeUndefined();
    expect(parseHello(JSON.stringify({ t: "hello", v: 1, room: "A".repeat(43) }))?.room).toHaveLength(43);
    expect(parseHello(JSON.stringify({ t: "hello", v: 2, room: "A".repeat(43) }))).toBeUndefined();
  });
});
