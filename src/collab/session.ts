import * as Y from "yjs";
import { canCollaborate, type CanvasPrivacyState } from "../lib/localOnly";
import type { DiagramFile } from "../model/types";
import { realClock, type Clock } from "./clock";
import { CollabDoc, REMOTE } from "./doc";
import { Opener, Sealer, SENDER_ID_BYTES, type Rejection } from "./envelope";
import type { GuardProblem } from "./guard";
import { deriveRoomKeys, type Channel, type RoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import {
  encodePresence,
  parsePresence,
  PresenceTable,
  randomAlias,
  type PeerPresence,
  type PresenceState,
} from "./presence";
import { DOC, frame, isEmptyUpdate, PRESENCE, unframe } from "./protocol";
import { secureRandom, type RandomBytes } from "./random";
import type { CollabTransport, PeerId } from "./transport/types";

// A room session: one person's CollabDoc joined to a room over a transport, with the room's E2E envelopes on every
// frame. Transport-neutral: it needs only the CollabTransport interface. All timing reads the room clock.
//
// Joining: the creator hydrates its document from its diagram; everyone else starts empty and waits for a peer (no
// peer, no document: an empty room is never presented as the diagram). On join, on every peer that appears, and
// every antiEntropyMs, a session sends its state vector; peers reply with exactly what it lacks. Local steps go out
// as updates. Nothing is forwarded on anyone's behalf.
//
// Refusals are counted by reason (`stats.rejected`), never thrown at the transport. A sender whose authenticated
// frame carries an update the guard refuses is quarantined: everything else it sends is ignored for the session.

export class PrivateDiagramError extends Error {
  constructor() {
    super("Private diagrams stay on this device: they can't join a room.");
    this.name = "PrivateDiagramError";
  }
}

export type SessionStatus = "waiting" | "connected" | "left";
export type RejectReason = Rejection | GuardProblem | "apply-failed" | "quarantined" | "rate-limited" | "malformed";

export interface SessionStats {
  framesSent: number;
  framesReceived: number;
  bytesSent: number;
  rejected: Partial<Record<RejectReason, number>>;
}

export interface SessionOptions {
  room: RoomLink;
  transport: CollabTransport;
  /** The diagram's privacy (the same state the Share gates read). A Private or local-only diagram never joins. */
  privacy: CanvasPrivacyState | null | undefined;
  /** The creator's diagram: hydrates an empty document. Joiners pass none and wait for a peer. */
  initial?: DiagramFile;
  /** A local copy of this room's document (rejoining). */
  doc?: CollabDoc;
  clock?: Clock;
  random?: RandomBytes;
  /** For tests: deterministic Yjs client id. */
  clientId?: number;
  presence?: Partial<PresenceState>;
}

/** A token bucket per sender on the room clock: bytes per window. */
class RateLimit {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly clock: Clock) {}
  take(sender: string, bytes: number): boolean {
    const now = this.clock.now();
    const cap = COLLAB_LIMITS.senderBytesPerWindow;
    const b = this.buckets.get(sender) ?? { tokens: cap, at: now };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) / COLLAB_LIMITS.senderWindowMs) * cap);
    b.at = now;
    this.buckets.set(sender, b);
    if (b.tokens < bytes) return false;
    b.tokens -= bytes;
    return true;
  }
}

export class CollabSession {
  readonly doc: CollabDoc;
  readonly presence: PresenceTable;
  readonly stats: SessionStats = { framesSent: 0, framesReceived: 0, bytesSent: 0, rejected: {} };
  /** This session's own presence. */
  me: PresenceState;
  status: SessionStatus = "waiting";

  private readonly sealer: Sealer;
  private readonly opener: Opener;
  private readonly rate: RateLimit;
  private readonly quarantined = new Set<string>();
  private outbox: Promise<void> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();
  private stops: (() => void)[] = [];
  private listeners = new Set<() => void>();

  private constructor(
    readonly keys: RoomKeys,
    readonly transport: CollabTransport,
    private readonly clock: Clock,
    sender: Uint8Array,
    doc: CollabDoc,
    me: PresenceState,
  ) {
    this.doc = doc;
    this.me = me;
    this.sealer = new Sealer(keys, sender);
    this.opener = new Opener(keys, sender);
    this.rate = new RateLimit(clock);
    this.presence = new PresenceTable(clock);
  }

  /** Joins (or creates) a room. Throws PrivateDiagramError for a diagram that stays on this device. */
  static async open(opts: SessionOptions): Promise<CollabSession> {
    // The diagram's own flag too: a Private file never joins, whatever state the caller passed.
    if (!canCollaborate(opts.privacy) || opts.initial?.private || opts.privacy?.diagram?.private)
      throw new PrivateDiagramError();
    const random = opts.random ?? secureRandom;
    const keys = await deriveRoomKeys(opts.room);
    const doc = opts.doc ?? new CollabDoc({ clientId: opts.clientId });
    if (opts.initial) doc.hydrate(opts.initial);
    const me = { ...randomAlias(() => random(1)[0] / 256), ...opts.presence };
    const session = new CollabSession(keys, opts.transport, opts.clock ?? realClock, random(SENDER_ID_BYTES), doc, me);
    session.start();
    return session;
  }

  get senderId(): string {
    return this.sealer.senderHex;
  }

  /** Whether this session has a document yet (a joiner has none until a peer answers). */
  get hasDocument(): boolean {
    return !this.doc.isEmpty();
  }

  peers(): PeerPresence[] {
    return this.presence.list();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setPresence(next: Partial<PresenceState>): void {
    this.me = { ...this.me, ...next };
    this.sendPresence();
  }

  /** Resolves once every frame this session has queued is sealed and handed to the transport, and every received
   *  frame is handled. */
  async idle(): Promise<void> {
    for (;;) {
      const [o, i] = [this.outbox, this.inbox];
      await Promise.all([o, i]);
      if (o === this.outbox && i === this.inbox) return;
    }
  }

  /** Leaves: says goodbye, stops timers and the transport. The local document stays (a local copy). */
  async leave(): Promise<void> {
    if (this.status === "left") return;
    this.send("doc", frame(DOC.bye));
    await this.idle();
    this.status = "left";
    for (const stop of this.stops) stop();
    this.stops = [];
    this.transport.close();
    this.emit();
  }

  private start(): void {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) this.send("doc", frame(DOC.update, update));
    };
    this.doc.ydoc.on("update", onUpdate);
    this.stops.push(() => this.doc.ydoc.off("update", onUpdate));
    this.stops.push(this.doc.onChange(() => this.emit()));
    this.stops.push(
      this.transport.subscribe({
        frame: (from, bytes) => this.enqueue(from, bytes),
        join: (peer) => {
          this.requestSync(peer);
          this.sendPresence(peer);
          this.updateStatus();
        },
        leave: () => this.updateStatus(),
      }),
    );
    this.stops.push(this.clock.every(COLLAB_LIMITS.antiEntropyMs, () => this.requestSync()));
    this.stops.push(
      this.clock.every(COLLAB_LIMITS.presenceHeartbeatMs, () => {
        this.sendPresence();
        if (this.presence.expire()) this.emit();
      }),
    );
    this.requestSync();
    this.sendPresence();
    this.updateStatus();
  }

  private updateStatus(): void {
    if (this.status === "left") return;
    const next: SessionStatus = this.transport.peers().length ? "connected" : "waiting";
    if (next !== this.status) {
      this.status = next;
      this.emit();
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private reject(reason: RejectReason): void {
    this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
  }

  private requestSync(to?: PeerId): void {
    this.send("doc", frame(DOC.syncRequest, this.doc.stateVector()), to);
  }

  private sendPresence(to?: PeerId): void {
    this.send("presence", frame(PRESENCE.state, encodePresence(this.me)), to);
  }

  /** Seals and sends in order. Sealing is asynchronous; the outbox keeps frames in the order they were made. */
  private send(channel: Channel, plaintext: Uint8Array, to?: PeerId): void {
    if (this.status === "left") return;
    this.outbox = this.outbox.then(async () => {
      try {
        const sealed = await this.sealer.seal(channel, plaintext);
        if (this.status === "left") return;
        this.transport.send(sealed, to);
        this.stats.framesSent++;
        this.stats.bytesSent += sealed.length;
      } catch {
        this.reject("too-large");
      }
    });
  }

  private enqueue(from: PeerId, bytes: Uint8Array): Promise<void> {
    this.inbox = this.inbox.then(() => this.receive(from, bytes));
    return this.inbox;
  }

  private async receive(from: PeerId, bytes: Uint8Array): Promise<void> {
    if (this.status === "left") return;
    this.stats.framesReceived++;
    const opened = await this.opener.open(bytes);
    if (!opened.ok) return this.reject(opened.reason);
    if (this.quarantined.has(opened.sender)) return this.reject("quarantined");
    const msg = unframe(opened.plaintext);
    if (!msg) return this.reject("malformed");
    if (opened.channel === "presence") {
      const state = msg.type === PRESENCE.state ? parsePresence(msg.payload) : undefined;
      if (!state) return this.reject("malformed");
      if (this.presence.receive(opened.sender, opened.counter, state)) this.emit();
      return;
    }
    if (!this.rate.take(opened.sender, bytes.length)) return this.reject("rate-limited");
    switch (msg.type) {
      case DOC.syncRequest: {
        let sv: Uint8Array;
        try {
          sv = msg.payload;
          Y.decodeStateVector(sv);
        } catch {
          return this.reject("malformed");
        }
        const diff = this.doc.encodeDiff(sv);
        if (!isEmptyUpdate(diff)) this.send("doc", frame(DOC.syncReply, diff), from);
        if (this.doc.lacksFrom(sv)) this.requestSync(from);
        return;
      }
      case DOC.syncReply:
      case DOC.update: {
        const result = this.doc.applyRemote(msg.payload);
        if (!result.ok) {
          this.quarantined.add(opened.sender);
          this.presence.remove(opened.sender);
          this.reject(result.problem);
        }
        return;
      }
      case DOC.bye:
        if (this.presence.remove(opened.sender)) this.emit();
        return;
      default:
        return this.reject("malformed");
    }
  }
}
