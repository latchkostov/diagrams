// Test-only: an offline stand-in for public BitTorrent trackers, WebSocket and WebRTC, so the tracker transport's
// signalling runs in CI without contacting anything. The fake tracker relays offers and answers the way the
// WebTorrent tracker protocol does; the fake peer connections put synthetic canaries (an ICE ufrag, a documentation
// IP address, a fingerprint) in their SDP, so a capture of what the tracker received proves none of it was readable.

import { FakeClock } from "../clock";

export const SDP_CANARIES = ["ice-ufrag:Quokkaufrag", "203.0.113.77", "fingerprint:sha-256 0F:AB:CD", "v=0"];

/** Everything queued for delivery (tracker messages, data channel messages), run by `pump`. */
export class FakeWire {
  queue: (() => void)[] = [];
  /** Every message a tracker received, as sent. */
  trackerLog: string[] = [];
  /** Every data channel message, as sent. */
  channelLog: Uint8Array[] = [];
  /** The transports' clock: a quiet round moves it a second, so a quick re-announce comes due. */
  readonly clock = new FakeClock();
  readonly channelTaps = new Set<(bytes: Uint8Array) => void>();

  /** Transports whose signalling work `pump` waits for. */
  private transports = new Set<{ settled(): Promise<void> }>();

  track<T extends { settled(): Promise<void> }>(transport: T): T {
    this.transports.add(transport);
    return transport;
  }

  /**
   * Runs queued deliveries until nothing is queued and nothing is in flight: the sessions (`idle`), the tracked
   * transports' signalling, and timers due within a second of fake time (a quick re-announce). No real time passes.
   */
  async pump(idle: () => Promise<void> = async () => {}): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      await idle();
      await Promise.all([...this.transports].map((t) => t.settled()));
      if (this.queue.length) {
        const batch = this.queue.splice(0);
        for (const run of batch) run();
        continue;
      }
      const due = this.clock.nextDue();
      if (due === undefined || due - this.clock.now() > 1_000) return;
      this.clock.advance(due - this.clock.now());
    }
    throw new Error("FakeWire.pump: never went quiet");
  }
}

interface SwarmPeer {
  socket: FakeWebSocket;
  peerId: string;
}

/** A tracker: swarms by info_hash; offers go to other peers in the swarm, answers to the named peer. */
export class FakeTracker {
  private swarms = new Map<string, Map<string, SwarmPeer>>();
  constructor(readonly wire: FakeWire) {}

  /** Sends a message to every peer in every swarm (a hostile tracker's replay). */
  broadcast(raw: string): void {
    for (const swarm of this.swarms.values()) for (const p of swarm.values()) p.socket.deliver(raw);
  }

  receive(socket: FakeWebSocket, raw: string): void {
    this.wire.trackerLog.push(raw);
    const msg = JSON.parse(raw) as Record<string, unknown>;
    if (msg.action !== "announce" || typeof msg.info_hash !== "string" || typeof msg.peer_id !== "string") return;
    let swarm = this.swarms.get(msg.info_hash);
    if (!swarm) this.swarms.set(msg.info_hash, (swarm = new Map()));
    if (msg.event === "stopped") {
      swarm.delete(msg.peer_id);
      return;
    }
    swarm.set(msg.peer_id, { socket, peerId: msg.peer_id });
    if (Array.isArray(msg.offers)) {
      const others = [...swarm.values()].filter((p) => p.peerId !== msg.peer_id);
      (msg.offers as { offer_id: string; offer: unknown }[]).forEach((o, i) => {
        const to = others[i % Math.max(1, others.length)];
        if (to)
          to.socket.deliver(
            JSON.stringify({
              action: "announce",
              info_hash: msg.info_hash,
              peer_id: msg.peer_id,
              offer_id: o.offer_id,
              offer: o.offer,
            }),
          );
      });
      socket.deliver(
        JSON.stringify({
          action: "announce",
          info_hash: msg.info_hash,
          interval: 120,
          complete: swarm.size,
          incomplete: 0,
        }),
      );
    }
    if (msg.answer && typeof msg.to_peer_id === "string") {
      swarm.get(msg.to_peer_id)?.socket.deliver(
        JSON.stringify({
          action: "announce",
          info_hash: msg.info_hash,
          peer_id: msg.peer_id,
          offer_id: msg.offer_id,
          answer: msg.answer,
        }),
      );
    }
  }
}

export class FakeWebSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    private readonly tracker: FakeTracker,
  ) {
    tracker.wire.queue.push(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("not open");
    this.tracker.wire.queue.push(() => this.tracker.receive(this, data));
  }

  deliver(data: string): void {
    this.tracker.wire.queue.push(() => this.readyState === 1 && this.onmessage?.({ data }));
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

let nextPc = 1;
const registry = new Map<number, FakePeerConnection>();

export class FakeDataChannel {
  binaryType = "blob";
  readyState = "connecting";
  partner?: FakeDataChannel;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(
    readonly label: string,
    private readonly wire: FakeWire,
  ) {}

  open(): void {
    this.wire.queue.push(() => {
      if (this.readyState !== "connecting") return;
      this.readyState = "open";
      this.onopen?.();
    });
  }

  send(data: Uint8Array): void {
    if (this.readyState !== "open") throw new Error("channel not open");
    const copy = data.slice();
    this.wire.channelLog.push(copy);
    for (const tap of this.wire.channelTaps) tap(copy);
    const partner = this.partner;
    this.wire.queue.push(() => partner?.readyState === "open" && partner.onmessage?.({ data: copy.buffer }));
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
    const partner = this.partner;
    if (partner && partner.readyState !== "closed") this.wire.queue.push(() => partner.close());
  }
}

export class FakePeerConnection {
  readonly id = nextPc++;
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remote?: FakePeerConnection;
  channel?: FakeDataChannel;
  ondatachannel: ((e: { channel: FakeDataChannel }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(private readonly wire: FakeWire) {
    registry.set(this.id, this);
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  createDataChannel(label: string): FakeDataChannel {
    this.channel = new FakeDataChannel(label, this.wire);
    return this.channel;
  }

  private sdp(type: string) {
    return `v=0\r\no=- ${this.id} 2 IN IP4 127.0.0.1\r\na=ice-ufrag:Quokkaufrag\r\nc=IN IP4 203.0.113.77\r\na=fingerprint:sha-256 0F:AB:CD\r\na=x-fake-pc:${this.id}\r\na=x-type:${type}\r\n`;
  }

  async createOffer() {
    return { type: "offer", sdp: this.sdp("offer") };
  }

  async createAnswer() {
    return { type: "answer", sdp: this.sdp("answer") };
  }

  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
  }

  async setRemoteDescription(d: { type: string; sdp: string }) {
    const id = Number(/a=x-fake-pc:(\d+)/.exec(d.sdp)?.[1]);
    const remote = registry.get(id);
    if (!remote) throw new Error("unknown remote");
    this.remote = remote;
    if (d.type === "answer") {
      // The offerer learns the answer: connect the offerer's channel with a new one on the answering side.
      const theirs = new FakeDataChannel(this.channel!.label, this.wire);
      this.channel!.partner = theirs;
      theirs.partner = this.channel;
      remote.wire.queue.push(() => remote.ondatachannel?.({ channel: theirs }));
      this.channel!.open();
      theirs.open();
      this.connectionState = remote.connectionState = "connected";
    }
  }

  close(): void {
    this.connectionState = "closed";
    this.channel?.close();
    registry.delete(this.id);
  }
}

/** Constructors bound to one wire, for createTrackerTransport's injection points. */
export function fakeEnvironment(wire = new FakeWire()) {
  const tracker = new FakeTracker(wire);
  return {
    wire,
    tracker,
    WebSocket: class extends FakeWebSocket {
      constructor(url: string) {
        super(url, tracker);
      }
    } as unknown as new (url: string) => WebSocket,
    RTCPeerConnection: class extends FakePeerConnection {
      constructor() {
        super(wire);
      }
    } as unknown as new (config: RTCConfiguration) => RTCPeerConnection,
  };
}
