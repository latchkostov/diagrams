import { describe, expect, it, onTestFinished, vi } from "vitest";
import { bytesToBase64Url } from "../../interop/codec";
import { deriveRoomKeys } from "../keys";
import { COLLAB_LIMITS } from "../limits";
import { seededBytes } from "../random";
import { CANARY, canaryDiagram, containsBytes, describeTransportConformance, openClient, roomFor } from "./conformance";
import { FakeDataChannel, FakePeerConnection, fakeEnvironment, SDP_CANARIES } from "./fakeWebrtc";
import { endpointList } from "../lab/demo";
import { createTrackerTransport, openSignal, sealSignal, SPIKE_TRACKERS } from "./tracker";

// The public-matchmaking spike's transport, tested offline: a fake tracker, fake WebSockets and fake peer
// connections (./fakeWebrtc.ts). Nothing here contacts a tracker, STUN or anything else.

const room = roomFor(1);
const keys = await deriveRoomKeys(room);

function environment(seed: number) {
  const env = fakeEnvironment();
  let n = 0;
  const connect = (k = keys) =>
    env.wire.track(
      createTrackerTransport({
        trackers: ["wss://tracker.invalid"],
        discovery: k.discovery,
        signal: k.signal,
        WebSocket: env.WebSocket,
        RTCPeerConnection: env.RTCPeerConnection,
        random: seededBytes(seed * 1000 + ++n),
        clock: env.wire.clock,
      }),
    );
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
  it("Retry invalidates an incoming offer still being authenticated", async () => {
    const { env, connect } = environment(20);
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const authenticating = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let first = true;
    let retiredSdp = "";
    const applySignal = vi.spyOn(FakePeerConnection.prototype, "setRemoteDescription");
    onTestFinished(() => applySignal.mockRestore());
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => {
      const result = await decrypt(...args);
      if (first) {
        first = false;
        retiredSdp = new TextDecoder().decode(result);
        entered();
        await held;
      }
      return result;
    });
    onTestFinished(() => spy.mockRestore());
    const a = connect(),
      b = connect();
    onTestFinished(() => {
      release();
      a.close();
      b.close();
    });
    const pumping = env.wire.pump();
    await authenticating;
    a.retry?.();
    b.retry?.();
    release();
    await pumping;
    expect(applySignal.mock.calls.some(([description]) => description.sdp === retiredSdp)).toBe(false);
    expect(a.peers()).toEqual([b.self]);
    expect(b.peers()).toEqual([a.self]);
  });

  for (const fault of ["stalled channel", "dropped first answer"] as const)
    it(`Retry reconnects after a ${fault}`, async () => {
      const { env, connect } = environment(19);
      let broken = true;
      if (fault === "stalled channel") {
        const open = FakeDataChannel.prototype.open;
        const spy = vi.spyOn(FakeDataChannel.prototype, "open").mockImplementation(function (this: FakeDataChannel) {
          if (!broken) open.call(this);
        });
        onTestFinished(() => spy.mockRestore());
      } else {
        const receive = env.tracker.receive.bind(env.tracker);
        const spy = vi.spyOn(env.tracker, "receive").mockImplementation((socket, raw) => {
          if (broken && (JSON.parse(raw) as { answer?: unknown }).answer) {
            broken = false;
            return;
          }
          receive(socket, raw);
        });
        onTestFinished(() => spy.mockRestore());
      }
      const a = connect();
      const b = connect();
      onTestFinished(() => {
        a.close();
        b.close();
      });
      const identities = [a.self, b.self];
      await env.wire.pump();
      expect([a.peers(), b.peers()]).toEqual([[], []]);
      broken = false;
      a.retry?.();
      b.retry?.();
      await env.wire.pump();
      expect(a.peers()).toEqual([b.self]);
      expect(b.peers()).toEqual([a.self]);
      expect([a.self, b.self]).toEqual(identities);
      // Retrying an established room preserves the channels and emits no leave/join pair.
      const leave = vi.fn(),
        join = vi.fn();
      a.subscribe({ join, leave, frame: () => {} });
      a.retry?.();
      await env.wire.pump();
      expect(a.peers()).toEqual([b.self]);
      expect(leave).not.toHaveBeenCalled();
      expect(join).not.toHaveBeenCalled();
    });

  it("retry replaces tracker sockets without replacing the transport identity", async () => {
    const env = fakeEnvironment();
    const sockets: WebSocket[] = [];
    const WS = class extends (env.WebSocket as unknown as new (url: string) => WebSocket) {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };
    const transport = env.wire.track(
      createTrackerTransport({
        trackers: ["wss://tracker.invalid"],
        discovery: keys.discovery,
        signal: keys.signal,
        WebSocket: WS,
        RTCPeerConnection: env.RTCPeerConnection,
        clock: env.wire.clock,
      }),
    );
    const self = transport.self;
    await env.wire.pump();
    expect(transport.diagnostics().trackersOpen).toBe(1);
    transport.retry?.();
    expect(sockets).toHaveLength(2);
    expect(sockets[0].readyState).toBe(3);
    expect([sockets[0].onopen, sockets[0].onmessage, sockets[0].onerror, sockets[0].onclose]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    await env.wire.pump();
    expect(transport.self).toBe(self);
    expect(transport.diagnostics().trackersOpen).toBe(1);
    transport.close();
    expect(sockets.every((socket) => socket.readyState === 3)).toBe(true);
    expect(env.wire.clock.pending).toBe(0);
  });

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

  it("binds an encrypted offer to its offer id, direction and signer", async () => {
    const random = seededBytes(3);
    const id = String.fromCharCode(...random(20));
    const signer = String.fromCharCode(...random(20));
    const sealed = await sealSignal(keys.signal, keys.discovery, "offer", id, signer, "v=0 sdp", random);
    expect(await openSignal(keys.signal, keys.discovery, "offer", id, signer, sealed)).toBe("v=0 sdp");
    expect(await openSignal(keys.signal, keys.discovery, "answer", id, signer, sealed)).toBeUndefined();
    const other = String.fromCharCode(...random(20));
    expect(await openSignal(keys.signal, keys.discovery, "offer", id, other, sealed)).toBeUndefined();
    expect(
      await openSignal(keys.signal, keys.discovery, "offer", String.fromCharCode(...random(20)), signer, sealed),
    ).toBeUndefined();
    expect(await openSignal(keys.signal, new Uint8Array(20), "offer", id, signer, sealed)).toBeUndefined();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BA" : "AA");
    expect(await openSignal(keys.signal, keys.discovery, "offer", id, signer, tampered)).toBeUndefined();
  });

  it("admits no more peers than its budget, however many offers arrive at once", async () => {
    const env = fakeEnvironment();
    const make = (maxPeers: number, random: (n: number) => Uint8Array) =>
      env.wire.track(
        createTrackerTransport({
          trackers: ["wss://tracker.invalid"],
          discovery: keys.discovery,
          signal: keys.signal,
          WebSocket: env.WebSocket,
          RTCPeerConnection: env.RTCPeerConnection,
          random,
          clock: env.wire.clock,
          maxPeers,
        }),
      );
    // The hub's peer id is the greatest possible, so it answers everyone's offers (the others ignore its own); it
    // joins first, so each newcomer's first offer goes to it, and they all arrive together.
    const rest = seededBytes(600);
    let first = true;
    const hub = make(2, (n) => (first ? ((first = false), new Uint8Array(n).fill(0xff)) : rest(n)));
    await env.wire.pump();
    const others = Array.from({ length: 6 }, (_, i) => make(8, seededBytes(500 + i)));
    await env.wire.pump();
    expect(hub.diagnostics().peers).toBe(2);
    for (const t of [hub, ...others]) t.close();
  });

  it("ignores an offer a tracker replays under another peer id", async () => {
    const env = fakeEnvironment();
    const events: string[] = [];
    const make = (i: number) =>
      env.wire.track(
        createTrackerTransport({
          trackers: ["wss://tracker.invalid"],
          discovery: keys.discovery,
          signal: keys.signal,
          WebSocket: env.WebSocket,
          RTCPeerConnection: env.RTCPeerConnection,
          random: seededBytes(700 + i),
          clock: env.wire.clock,
          onEvent: (e) => void events.push(e),
        }),
      );
    const a = make(1);
    await env.wire.pump();
    const offerMsg = env.wire.trackerLog
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((m) => Array.isArray(m.offers) && (m.offers as unknown[]).length);
    expect(offerMsg).toBeDefined();
    const b = make(2);
    await env.wire.pump();
    const answered = events.filter((e) => e === "answered an offer").length;
    // A hostile tracker relays a's captured offer to everyone under a forged (smallest possible) peer id, which
    // both would answer by id order if the offer opened.
    const offer = (offerMsg!.offers as { offer_id: string; offer: unknown }[])[0];
    const forged = String.fromCharCode(...new Array<number>(20).fill(0));
    env.tracker.broadcast(
      JSON.stringify({
        action: "announce",
        info_hash: offerMsg!.info_hash,
        peer_id: forged,
        offer_id: offer.offer_id,
        offer: offer.offer,
      }),
    );
    await env.wire.pump();
    expect(events.filter((e) => e === "answered an offer").length).toBe(answered);
    expect(events.filter((e) => e.includes("replayed or tampered")).length).toBeGreaterThanOrEqual(2);
    a.close();
    b.close();
  });

  it("a forgery reusing an offer id doesn't block the genuine offer", async () => {
    const env = fakeEnvironment();
    const make = (random: (n: number) => Uint8Array, offers?: number) =>
      env.wire.track(
        createTrackerTransport({
          trackers: ["wss://tracker.invalid"],
          discovery: keys.discovery,
          signal: keys.signal,
          WebSocket: env.WebSocket,
          RTCPeerConnection: env.RTCPeerConnection,
          random,
          clock: env.wire.clock,
          offers,
        }),
      );
    const a = make(seededBytes(801));
    await env.wire.pump();
    const offerMsg = env.wire.trackerLog
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((m) => Array.isArray(m.offers) && (m.offers as unknown[]).length)!;
    const offer = (offerMsg.offers as { offer_id: string; offer: { type: string; sdp: string } }[])[0];
    // b's id is the greatest, so it is the one that answers a's offers.
    const rest = seededBytes(802);
    let first = true;
    // b joins the swarm without offers of its own, so the only way to connect is a's relayed offer.
    const b = make((n) => (first ? ((first = false), new Uint8Array(n).fill(0xff)) : rest(n)), 0);
    await env.wire.pump();
    const relay = (sdp: string) =>
      env.tracker.broadcast(
        JSON.stringify({
          action: "announce",
          info_hash: offerMsg.info_hash,
          peer_id: offerMsg.peer_id,
          offer_id: offer.offer_id,
          offer: { type: "offer", sdp },
        }),
      );
    // The forgery first, then the genuine offer (as if through a second tracker).
    relay("ld1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    relay(offer.offer.sdp);
    await env.wire.pump();
    const answered = env.wire.trackerLog
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .some((m) => m.answer && m.offer_id === offer.offer_id);
    expect(answered).toBe(true);
    a.close();
    b.close();
  });

  it("reads endpoint lists split on whitespace, keeping every URL whole", () => {
    expect(endpointList(`${SPIKE_TRACKERS.join("\n")}\n  `)).toEqual(SPIKE_TRACKERS);
    expect(endpointList("stun:stun.cloudflare.com:3478 stun:other.example:3478")).toEqual([
      "stun:stun.cloudflare.com:3478",
      "stun:other.example:3478",
    ]);
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
