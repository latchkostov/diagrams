import { describe, expect, it } from "vitest";
import { bytesToBase64Url } from "../../interop/codec";
import { deriveRoomKeys } from "../keys";
import { COLLAB_LIMITS } from "../limits";
import { seededBytes } from "../random";
import { CANARY, canaryDiagram, containsBytes, describeTransportConformance, openClient, roomFor } from "./conformance";
import { fakeEnvironment, SDP_CANARIES } from "./fakeWebrtc";
import { createTrackerTransport, openSignal, sealSignal, SPIKE_TRACKERS } from "./tracker";

// The public-matchmaking spike's transport, tested offline: a fake tracker, fake WebSockets and fake peer
// connections (./fakeWebrtc.ts). Nothing here contacts a tracker, STUN or anything else.

const room = roomFor(1);
const keys = await deriveRoomKeys(room);

function environment(seed: number) {
  const env = fakeEnvironment();
  let n = 0;
  const connect = (k = keys) =>
    createTrackerTransport({
      trackers: ["wss://tracker.invalid"],
      discovery: k.discovery,
      signal: k.signal,
      WebSocket: env.WebSocket,
      RTCPeerConnection: env.RTCPeerConnection,
      random: seededBytes(seed * 1000 + ++n),
      clock: env.wire.clock,
    });
  return { env, connect };
}

describeTransportConformance("webrtc-tracker (offline fake)", (seed) => {
  const { env, connect } = environment(seed);
  return {
    connect: () => connect(),
    settle: (idle) => env.wire.pump(idle),
    tap: (fn) => {
      env.wire.channelTaps.add(fn);
      return () => env.wire.channelTaps.delete(fn);
    },
    maxFrameBytes: COLLAB_LIMITS.maxDocFrameBytes + 64,
  };
});

describe("public matchmaking: what a tracker sees (synthetic capture)", () => {
  it("sees the discovery hash, random ids and ciphertext: no key, no SDP, no diagram", async () => {
    const { env, connect } = environment(7);
    const clock = env.wire.clock;
    const a = await openClient("a", connect(), room, clock, 1, { initial: canaryDiagram() });
    const b = await openClient("b", connect(), room, clock, 2);
    const settle = () => env.wire.pump(async () => void (await Promise.all([a, b].map((x) => x.session.idle()))));
    await settle();
    expect(b.diagram?.title).toBe(canaryDiagram().title);
    a.edit((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, label: `${CANARY} renamed` })) }));
    await settle();
    expect(b.diagram?.nodes[0].label).toBe(`${CANARY} renamed`);

    const log = env.wire.trackerLog;
    expect(log.length).toBeGreaterThan(0);
    const secrets = [
      bytesToBase64Url(room.secret),
      Array.from(room.secret, (v) => v.toString(16).padStart(2, "0")).join(""),
      String.fromCharCode(...room.secret),
      keys.roomId,
    ];
    for (const raw of log) {
      for (const s of [...secrets, CANARY, ...SDP_CANARIES]) expect(raw).not.toContain(s);
      const msg = JSON.parse(raw) as Record<string, unknown>;
      // What it does see: the room's discovery hash, a random peer id, opaque offers and answers.
      expect(msg.info_hash).toBe(String.fromCharCode(...keys.discovery));
      for (const o of (msg.offers as { offer: { sdp: string } }[] | undefined) ?? [])
        expect(o.offer.sdp).toMatch(/^ld1\.[A-Za-z0-9_-]+$/);
      if (msg.answer) expect((msg.answer as { sdp: string }).sdp).toMatch(/^ld1\.[A-Za-z0-9_-]+$/);
    }
    // And the data channels carry only room envelopes.
    for (const bytes of env.wire.channelLog) {
      expect(new TextDecoder("latin1").decode(bytes)).not.toContain(CANARY);
      expect(containsBytes(bytes, room.secret)).toBe(false);
    }
  });

  it("never connects peers of different rooms that share a tracker", async () => {
    const { env, connect } = environment(8);
    const other = await deriveRoomKeys(roomFor(2));
    const a = connect();
    // Same discovery hash (a collision, or someone replaying it), different signalling key: offers don't open.
    const b = connect({ ...other, discovery: keys.discovery });
    await env.wire.pump();
    expect(a.peers()).toEqual([]);
    expect(b.peers()).toEqual([]);
  });

  it("binds an encrypted offer to its offer id and direction", async () => {
    const random = seededBytes(3);
    const id = String.fromCharCode(...random(20));
    const sealed = await sealSignal(keys.signal, keys.discovery, "offer", id, "v=0 sdp", random);
    expect(await openSignal(keys.signal, keys.discovery, "offer", id, sealed)).toBe("v=0 sdp");
    expect(await openSignal(keys.signal, keys.discovery, "answer", id, sealed)).toBeUndefined();
    expect(
      await openSignal(keys.signal, keys.discovery, "offer", String.fromCharCode(...random(20)), sealed),
    ).toBeUndefined();
    expect(await openSignal(keys.signal, new Uint8Array(20), "offer", id, sealed)).toBeUndefined();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BA" : "AA");
    expect(await openSignal(keys.signal, keys.discovery, "offer", id, tampered)).toBeUndefined();
  });

  it("only talks to wss:// trackers (or a loopback ws:// one for local tests)", async () => {
    const env = fakeEnvironment();
    const opened: string[] = [];
    const WS = class extends (env.WebSocket as unknown as new (url: string) => { url: string }) {
      constructor(url: string) {
        super(url);
        opened.push(url);
      }
    } as unknown as new (url: string) => WebSocket;
    const t = createTrackerTransport({
      trackers: ["ws://tracker.example", "https://x.example", "wss://ok.example", "ws://127.0.0.1:6411/"],
      discovery: keys.discovery,
      signal: keys.signal,
      WebSocket: WS,
      RTCPeerConnection: env.RTCPeerConnection,
      clock: env.wire.clock,
    });
    t.close();
    expect(opened).toEqual(["wss://ok.example", "ws://127.0.0.1:6411/"]);
  });

  it("lists only wss:// public trackers for the spike", () => {
    expect(SPIKE_TRACKERS.every((u) => u.startsWith("wss://"))).toBe(true);
  });
});
