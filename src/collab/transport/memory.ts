import { seededRandom } from "../random";
import { FrameTooLargeError, type CollabTransport, type PeerId, type TransportHandlers } from "./types";

// An in-memory network for tests and the Lab: no sockets, no timers, nothing leaves the page. Delivery happens only
// when `settle()` runs, in an order drawn from a seed, with seeded faults: drops, duplicates, reordering and
// partitions (a partitioned link drops what it carries, as a real one does, and both ends see `leave`; healing
// it sends `join`). A failing schedule replays exactly from its seed.

export interface Faults {
  /** Probability a frame is lost. */
  drop: number;
  /** Probability a delivered frame is delivered again later. */
  duplicate: number;
  /** Deliver queued frames in a random order rather than first-in, first-out. */
  reorder: boolean;
}

export const NO_FAULTS: Faults = { drop: 0, duplicate: 0, reorder: false };

export interface WireRecord {
  from: PeerId;
  to: PeerId;
  bytes: Uint8Array;
}

export interface NetworkStats {
  sent: number;
  delivered: number;
  dropped: number;
  duplicated: number;
  bytes: number;
}

interface Endpoint {
  id: PeerId;
  handlers?: TransportHandlers;
  closed: boolean;
}

export class MemoryNetwork {
  readonly stats: NetworkStats = { sent: 0, delivered: 0, dropped: 0, duplicated: 0, bytes: 0 };
  private random: () => number;
  private faults: Faults;
  private endpoints = new Map<PeerId, Endpoint>();
  private queue: WireRecord[] = [];
  private groups: PeerId[][] | undefined;
  private taps = new Set<(r: WireRecord) => void>();
  private nextId = 1;
  readonly maxFrameBytes: number;

  constructor(opts: { seed?: number; faults?: Partial<Faults>; maxFrameBytes?: number } = {}) {
    this.random = seededRandom(opts.seed ?? 1);
    this.faults = { ...NO_FAULTS, ...opts.faults };
    this.maxFrameBytes = opts.maxFrameBytes ?? 16 * 1024 * 1024;
  }

  setFaults(f: Partial<Faults>): void {
    this.faults = { ...this.faults, ...f };
  }

  /** Sees every frame put on the wire (a capture: what a network observer would see). */
  tap(fn: (r: WireRecord) => void): () => void {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  }

  connect(): CollabTransport {
    const endpoint: Endpoint = { id: `m${this.nextId++}`, closed: false };
    const reachable = this.live().filter((e) => this.linked(e.id, endpoint.id));
    this.endpoints.set(endpoint.id, endpoint);
    for (const e of reachable) e.handlers?.join(endpoint.id);
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the transport object's methods close over the network.
    const net = this;
    return {
      capabilities: { kind: "memory", durable: false, maxFrameBytes: this.maxFrameBytes },
      self: endpoint.id,
      peers: () => (endpoint.closed ? [] : net.reachableFrom(endpoint.id)),
      send(bytes, to) {
        if (endpoint.closed) return;
        if (bytes.length > net.maxFrameBytes) throw new FrameTooLargeError(bytes.length, net.maxFrameBytes);
        const targets = to === undefined ? net.reachableFrom(endpoint.id) : to === endpoint.id ? [] : [to];
        for (const target of targets) {
          const record = { from: endpoint.id, to: target, bytes: bytes.slice() };
          net.stats.sent++;
          net.stats.bytes += bytes.length;
          for (const tap of net.taps) tap(record);
          net.queue.push(record);
        }
      },
      subscribe(handlers) {
        endpoint.handlers = handlers;
        // A new end learns who is reachable already, as the ones already there learned of it.
        for (const p of net.reachableFrom(endpoint.id)) handlers.join(p);
        return () => {
          if (endpoint.handlers === handlers) endpoint.handlers = undefined;
        };
      },
      close() {
        if (endpoint.closed) return;
        const peers = net.reachableFrom(endpoint.id);
        endpoint.closed = true;
        net.endpoints.delete(endpoint.id);
        for (const p of peers) net.endpoints.get(p)?.handlers?.leave(endpoint.id);
      },
    };
  }

  /** Splits the network: peers in different groups can't reach each other. Peers in no group are isolated. */
  partition(groups: PeerId[][]): void {
    const before = this.pairs();
    this.groups = groups.map((g) => [...g]);
    this.announce(before);
  }

  heal(): void {
    const before = this.pairs();
    this.groups = undefined;
    this.announce(before);
  }

  /** Frames waiting for delivery. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Delivers queued frames (and what handling them sends) until none are left, awaiting each handler, and
   * `idle` between rounds (a session's sealing is asynchronous: its replies reach the wire a little later).
   */
  async settle(idle: () => Promise<void> = async () => {}, maxDeliveries = 1_000_000): Promise<void> {
    let deliveries = 0;
    for (;;) {
      await idle();
      if (!this.queue.length) {
        await idle();
        if (!this.queue.length) return;
      }
      while (this.queue.length) {
        if (++deliveries > maxDeliveries) throw new Error("MemoryNetwork.settle: the network never went quiet");
        const at = this.faults.reorder ? Math.floor(this.random() * this.queue.length) : 0;
        const [record] = this.queue.splice(at, 1);
        await this.deliver(record);
      }
    }
  }

  private async deliver(record: WireRecord): Promise<void> {
    const target = this.endpoints.get(record.to);
    if (!target || target.closed || !this.linked(record.from, record.to) || this.random() < this.faults.drop) {
      this.stats.dropped++;
      return;
    }
    if (this.random() < this.faults.duplicate) {
      this.stats.duplicated++;
      this.queue.push({ ...record, bytes: record.bytes.slice() });
    }
    this.stats.delivered++;
    await target.handlers?.frame(record.from, record.bytes.slice());
  }

  private live(): Endpoint[] {
    return [...this.endpoints.values()].filter((e) => !e.closed);
  }

  private linked(a: PeerId, b: PeerId): boolean {
    if (a === b) return false;
    if (!this.groups) return true;
    return this.groups.some((g) => g.includes(a) && g.includes(b));
  }

  private reachableFrom(id: PeerId): PeerId[] {
    return this.live()
      .map((e) => e.id)
      .filter((p) => this.linked(id, p));
  }

  private pairs(): Set<string> {
    const out = new Set<string>();
    for (const a of this.live()) for (const b of this.live()) if (this.linked(a.id, b.id)) out.add(`${a.id}>${b.id}`);
    return out;
  }

  /** Sends join/leave for every directed link that appeared or vanished. */
  private announce(before: Set<string>): void {
    const after = this.pairs();
    for (const pair of before)
      if (!after.has(pair)) {
        const [a, b] = pair.split(">");
        this.endpoints.get(a)?.handlers?.leave(b);
      }
    for (const pair of after)
      if (!before.has(pair)) {
        const [a, b] = pair.split(">");
        this.endpoints.get(a)?.handlers?.join(b);
      }
  }
}
