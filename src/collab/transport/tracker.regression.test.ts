import { expect, it, onTestFinished, vi } from "vitest";
import { FakeClock } from "../clock";
import { deriveRoomKeys } from "../keys";
import { seededBytes } from "../random";
import { roomFor } from "./conformance";
import { fakeEnvironment, FakeDataChannel, FakePeerConnection } from "./fakeWebrtc";
import { createTrackerTransport, COLLAB_TRACKERS } from "./tracker";

const keys = await deriveRoomKeys(roomFor(901));
const infoHash = String.fromCharCode(...keys.discovery);

/** Script each socket independently, including response ordering and repeated connection loss. */
class Socket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  deliver(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ info_hash: infoHash, ...msg }) });
  }
}

function scripted() {
  const env = fakeEnvironment();
  const sockets: Socket[] = [];
  const clock = new FakeClock();
  let first = true;
  const seeded = seededBytes(59);
  const transport = createTrackerTransport({
    trackers: COLLAB_TRACKERS,
    discovery: keys.discovery,
    signal: keys.signal,
    clock,
    // The lesser peer must re-announce when the greater peer offers.
    random: (n) => (first ? ((first = false), new Uint8Array(n)) : seeded(n)),
    WebSocket: class extends Socket {
      constructor() {
        super();
        sockets.push(this);
      }
    } as unknown as new (url: string) => WebSocket,
    RTCPeerConnection: env.RTCPeerConnection,
  });
  onTestFinished(() => transport.close());
  return { transport, sockets, clock };
}

for (const lateReply of [0, 1])
  it(`a late interval from tracker ${lateReply + 1} cannot postpone a quick announce`, async () => {
    const {
      transport,
      sockets: [one, two],
      clock,
    } = scripted();
    one.open();
    two.open();
    await transport.settled();
    one.deliver({ interval: 120 });
    one.deliver({ peer_id: "\xff".repeat(20), offer_id: "o".repeat(20), offer: { sdp: "ignored by the lesser peer" } });
    [one, two][lateReply].deliver({ interval: 120 });
    clock.advance(500);
    await transport.settled();
    expect(one.sent).toHaveLength(2);
    expect(two.sent).toHaveLength(1);
    // The same newcomer on another tracker gets its own quick response, not the first tracker's guard.
    two.deliver({ peer_id: "\xff".repeat(20), offer_id: "p".repeat(20), offer: { sdp: "ignored" } });
    two.deliver({ interval: 120 });
    clock.advance(500);
    await transport.settled();
    expect(two.sent).toHaveLength(2);
    // The quick timer must not reset the remembered periodic interval to the default 30 seconds.
    clock.advance(30_000);
    await transport.settled();
    expect([one.sent.length, two.sent.length]).toEqual([2, 2]);
  });

it("each tracker keeps its own periodic interval", async () => {
  const {
    transport,
    sockets: [one, two],
    clock,
  } = scripted();
  one.open();
  two.open();
  await transport.settled();
  one.deliver({ interval: 10 });
  two.deliver({ interval: 120 });
  for (let i = 0; i < 4; i++) {
    clock.advance(10_000);
    await transport.settled();
  }
  expect([one.sent.length, two.sent.length]).toEqual([5, 1]);
});

it("closed trackers reconnect independently with capped jittered backoff and stop on close", async () => {
  const { transport, sockets, clock } = scripted();
  const self = transport.self;
  sockets[0].open();
  sockets[1].open();
  await transport.settled();
  // The healthy tracker retains its interval; repeatedly failing handshakes cannot spin a socket loop.
  sockets[1].deliver({ interval: 120 });
  const attempts: number[] = [];
  let socket = sockets[0];
  for (let i = 0; i < 10; i++) {
    socket.deliver({ interval: 120 });
    socket.close();
    const before = clock.now();
    const count = sockets.length;
    for (let step = 0; sockets.length === count && step < 8; step++) {
      clock.advance(clock.nextDue()! - clock.now());
      await transport.settled();
    }
    expect(sockets).toHaveLength(count + 1);
    attempts.push(clock.now() - before);
    socket = sockets.at(-1)!;
    socket.open();
    await transport.settled();
  }
  expect(attempts[1]).toBeGreaterThanOrEqual(attempts[0]);
  expect(Math.max(...attempts)).toBeLessThanOrEqual(120_000);
  expect(attempts.at(-1)).toBeGreaterThanOrEqual(60_000);
  expect(transport.self).toBe(self);
  expect(transport.diagnostics().trackersOpen).toBe(2);
  socket.close();
  const count = sockets.length;
  transport.close();
  clock.advance(3_600_000);
  await transport.settled();
  expect(sockets).toHaveLength(count);
  expect(clock.pending).toBe(0);
});

it("automatic tracker reconnect preserves established channels and lets a new peer join", async () => {
  const env = fakeEnvironment();
  const sockets: WebSocket[] = [];
  const WS = class extends env.WebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  };
  const connect = (seed: number) =>
    env.wire.track(
      createTrackerTransport({
        trackers: [COLLAB_TRACKERS[0]],
        discovery: keys.discovery,
        signal: keys.signal,
        WebSocket: WS,
        RTCPeerConnection: env.RTCPeerConnection,
        clock: env.wire.clock,
        random: seededBytes(seed),
      }),
    );
  const a = connect(71),
    b = connect(72);
  const clients = [a, b];
  onTestFinished(() => clients.forEach((c) => c.close()));
  await env.wire.pump();
  expect(a.peers()).toEqual([b.self]);
  const join = vi.fn(),
    leave = vi.fn();
  a.subscribe({ join, leave, frame() {} });
  sockets[0].close();
  expect(a.peers()).toEqual([b.self]);
  await env.wire.pump();
  expect(sockets).toHaveLength(3);
  expect(leave).not.toHaveBeenCalled();
  expect(join).not.toHaveBeenCalled();
  const c = connect(73);
  clients.push(c);
  await env.wire.pump();
  expect([...a.peers()].sort()).toEqual([b.self, c.self].sort());
  expect([...c.peers()].sort()).toEqual([a.self, b.self].sort());
});

it("an hour of tracker outages has a bounded reconnect count, including constructor failures", async () => {
  const clock = new FakeClock();
  const attempts: number[] = [];
  const transport = createTrackerTransport({
    trackers: [COLLAB_TRACKERS[0]],
    discovery: keys.discovery,
    signal: keys.signal,
    clock,
    random: seededBytes(99),
    WebSocket: class {
      readonly readyState = 3;
      constructor() {
        attempts.push(clock.now());
        throw new Error("offline");
      }
    } as unknown as new (url: string) => WebSocket,
  });
  onTestFinished(() => transport.close());
  clock.advance(3_600_000);
  expect(attempts.length).toBeGreaterThan(10);
  expect(attempts.length).toBeLessThan(70);
  expect(new Set(attempts.slice(1).map((at, i) => at - attempts[i])).size).toBeGreaterThan(5);
  expect(transport.diagnostics().connectivity).toBe("trackers-unreachable");
  transport.close();
  expect(clock.pending).toBe(0);
});

it("diagnostics distinguish empty matchmaking, stalled/failed handshakes and a departed peer", async () => {
  const env = fakeEnvironment();
  let stall = true;
  const open = FakeDataChannel.prototype.open;
  const spy = vi.spyOn(FakeDataChannel.prototype, "open").mockImplementation(function (this: FakeDataChannel) {
    if (!stall) open.call(this);
  });
  onTestFinished(() => spy.mockRestore());
  const pcs: FakePeerConnection[] = [];
  const PC = class extends FakePeerConnection {
    constructor() {
      super(env.wire);
      pcs.push(this);
    }
  };
  const connect = (seed: number) =>
    env.wire.track(
      createTrackerTransport({
        trackers: [COLLAB_TRACKERS[0]],
        discovery: keys.discovery,
        signal: keys.signal,
        WebSocket: env.WebSocket,
        RTCPeerConnection: PC as unknown as new (config: RTCConfiguration) => RTCPeerConnection,
        clock: env.wire.clock,
        random: seededBytes(seed),
      }),
    );
  const a = connect(20);
  onTestFinished(() => a.close());
  await env.wire.pump();
  expect(a.connectivity?.()).toBe("waiting");
  const b = connect(21);
  onTestFinished(() => b.close());
  await env.wire.pump();
  expect([a.connectivity?.(), b.connectivity?.()]).toEqual(["no-answer", "no-answer"]);
  for (const pc of pcs) {
    pc.iceConnectionState = "failed";
    pc.oniceconnectionstatechange?.();
  }
  expect([a.connectivity?.(), b.connectivity?.()]).toEqual(["ice-failed", "ice-failed"]);
  stall = false;
  a.retry?.();
  b.retry?.();
  await env.wire.pump();
  expect([a.connectivity?.(), b.connectivity?.()]).toEqual(["connected", "connected"]);
  b.close();
  await env.wire.pump();
  expect(a.connectivity?.()).toBe("peer-left");
});

it("defaults contain exactly the two approved trackers", () => {
  expect(COLLAB_TRACKERS).toEqual(["wss://tracker.openwebtorrent.com", "wss://tracker.webtorrent.dev"]);
});
