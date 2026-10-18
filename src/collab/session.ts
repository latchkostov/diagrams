import * as Y from "yjs";
import { canCollaborate, type CanvasPrivacyState } from "../lib/localOnly";
import type { DiagramFile } from "../model/types";
import { realClock, type Clock } from "./clock";
import { CollabDoc, REMOTE } from "./doc";
import { Opener, Sealer, SENDER_ID_BYTES, type Rejection } from "./envelope";
import type { GuardProblem } from "./guard";
import { reserveRoomCreation, deriveRoomKeys, type Channel, type RoomKeys } from "./keys";
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
import { DOC, frame, fragment, isEmptyUpdate, PRESENCE, Reassembler, unframe } from "./protocol";
import { secureRandom, type RandomBytes } from "./random";
import type { CollabTransport, Connectivity, PeerId } from "./transport/types";
import { RoomRecovery } from "./recovery";
import type { RecoveryStore } from "./recoveryStore";

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
export const CONNECTION_WAIT_MS = COLLAB_LIMITS.connectionWaitMs;
export type RoomStatus = "connecting" | "offline" | "saved-device" | "synced";
export type RejectReason =
  | Rejection
  | GuardProblem
  | "apply-failed"
  | "quarantined"
  | "rate-limited"
  | "reply-throttled"
  | "request-throttled"
  | "proof-throttled"
  | "queue-full"
  | "too-many-partials"
  | "internal"
  | "malformed";

export interface SessionStats {
  framesSent: number;
  framesReceived: number;
  bytesSent: number;
  rejected: Partial<Record<RejectReason, number>>;
}

export interface SessionOptions {
  /** Explicit Lab room only: ordinary local documents never use this store. */
  recovery?: RecoveryStore;
  room: RoomLink;
  transport: CollabTransport;
  /** The diagram's privacy (the same state the Share gates read). A Private or local-only diagram never joins. */
  privacy: CanvasPrivacyState | null | undefined;
  /** Seeds only a fresh newRoom() on its first open. A link/rejoin always merges the room's CRDT state. */
  initial?: DiagramFile;
  /** A local copy of this room's document (rejoining). */
  doc?: CollabDoc;
  clock?: Clock;
  random?: RandomBytes;
  /** For tests: deterministic Yjs client id. */
  clientId?: number;
  presence?: Partial<PresenceState>;
}

/** A token bucket per sender on the room clock: `cap` bytes per window. */
class RateLimit {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly clock: Clock,
    private readonly cap: number,
  ) {}
  take(sender: string, bytes: number): boolean {
    const now = this.clock.now();
    const cap = this.cap;
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
  connectionFailed = false;
  connectivity: Connectivity = "waiting";
  private connectionWait?: () => void;
  recovery?: RoomRecovery;
  private synced = new Set<PeerId>();
  private revision = 0;
  private elementIds = 0;

  private readonly sealer: Sealer;
  private readonly opener: Opener;
  private readonly rate: RateLimit;
  /** What this session sends back to each requester: a member asking for the whole room again and again can't make
   *  it send megabytes per request. */
  private readonly replies: RateLimit;
  /** Sync requests answered per requester: each costs an encode of what it lacks, before any reply is sent. */
  private readonly requests: RateLimit;
  private readonly proofs: RateLimit;
  /** Bytes of frames waiting in the inbox: in total and per transport peer. */
  private queuedBytes = 0;
  private readonly queuedFrom = new Map<PeerId, number>();
  /** Set as leave() starts: nothing more is taken in. */
  private leaving = false;
  private leaveJob?: Promise<void>;
  /** Large document messages arriving in fragments, and the ids of those this session sends. */
  private readonly reassembler: Reassembler;
  private nextMessage = 0;
  private readonly quarantined = new Set<string>();
  private outbox: Promise<void> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();
  private proofJob: Promise<void> = Promise.resolve();
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
    this.rate = new RateLimit(clock, COLLAB_LIMITS.senderBytesPerWindow);
    this.replies = new RateLimit(clock, COLLAB_LIMITS.replyBytesPerWindow);
    this.requests = new RateLimit(clock, COLLAB_LIMITS.syncRequestsPerWindow);
    this.proofs = new RateLimit(clock, COLLAB_LIMITS.syncProofsPerWindow);
    this.reassembler = new Reassembler(clock);
    this.presence = new PresenceTable(clock);
  }

  /** Joins (or creates) a room. Throws PrivateDiagramError for a diagram that stays on this device. */
  static async open(opts: SessionOptions): Promise<CollabSession> {
    // The diagram's own flag too: a Private file never joins, whatever state the caller passed.
    if (!canCollaborate(opts.privacy) || opts.initial?.private || opts.privacy?.diagram?.private)
      throw new PrivateDiagramError();
    const creation = reserveRoomCreation(opts.room);
    let doc = opts.doc;
    let session: CollabSession | undefined;
    try {
      const random = opts.random ?? secureRandom;
      const keys = await deriveRoomKeys(opts.room);
      doc ??= new CollabDoc({ clientId: opts.clientId });
      const recovery = opts.recovery
        ? new RoomRecovery(opts.recovery, keys, () => session?.emit(), Date.now, opts.clock ?? realClock)
        : undefined;
      await recovery?.restore(doc);
      if (creation && opts.initial && doc.isEmpty()) doc.hydrate(opts.initial);
      const me = { ...randomAlias(() => random(1)[0] / 256), ...opts.presence };
      session = new CollabSession(keys, opts.transport, opts.clock ?? realClock, random(SENDER_ID_BYTES), doc, me);
      session.recovery = recovery;
      session.start();
      recovery?.watch(doc);
      creation?.commit();
      return session;
    } catch (error) {
      try {
        await session?.leave();
      } finally {
        if (!opts.doc) doc?.destroy();
        creation?.rollback();
      }
      throw error;
    }
  }

  get senderId(): string {
    return this.sealer.senderHex;
  }

  /** Allocation survives editor remounts within this session; a rejoin draws a new sender id. */
  newId(base: string): string {
    const suffix = `-${this.senderId}-${++this.elementIds}`;
    const stem = base.replace(/-[a-f0-9]{32}-\d+$/, "") || "element";
    return `${stem.slice(0, COLLAB_LIMITS.maxKeyChars - 1 - suffix.length)}${suffix}`;
  }

  get roomStatus(): RoomStatus {
    if (this.status === "left") return this.recovery?.saved ? "saved-device" : "offline";
    const peers = this.transport.peers();
    if (peers.length && peers.every((peer) => this.synced.has(peer)) && this.hasDocument) return "synced";
    if (this.recovery?.saved) return "saved-device";
    return this.status === "connected" || !this.hasDocument ? "connecting" : "offline";
  }

  /** Whether this session has a document yet (a joiner has none until a peer answers). */
  get hasDocument(): boolean {
    return !this.doc.isEmpty();
  }

  peers(): PeerPresence[] {
    return this.presence.list();
  }

  retryConnection(): void {
    if (this.leaving || this.status === "left") return;
    this.connectionWait?.();
    this.connectionWait = undefined;
    this.connectionFailed = false;
    this.transport.retry?.();
    this.requestSync();
    this.updateStatus();
    this.emit();
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
      const [o, i, p] = [this.outbox, this.inbox, this.proofJob];
      await Promise.all([o, i, p]);
      if (o === this.outbox && i === this.inbox && p === this.proofJob) return;
    }
  }

  /** Leaves: says goodbye, stops timers and the transport. The local document stays (a local copy). */
  leave(): Promise<void> {
    return (this.leaveJob ??= this.finishLeaving());
  }

  private async finishLeaving(): Promise<void> {
    if (this.status === "left" || this.leaving) return;
    this.leaving = true;
    try {
      // Only the goodbye is waited for; frames still queued inbound are dropped (receive checks `leaving`).
      this.sendDoc(frame(DOC.bye));
      await this.outbox.catch(() => {});
    } finally {
      this.status = "left";
      this.connectionFailed = false;
      this.connectionWait?.();
      this.connectionWait = undefined;
      for (const stop of this.stops) stop();
      this.stops = [];
      this.transport.close();
      await this.recovery?.close(this.doc);
      this.emit();
    }
  }

  private start(): void {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) this.sendDoc(frame(DOC.update, update));
    };
    this.doc.ydoc.on("update", onUpdate);
    this.stops.push(() => this.doc.ydoc.off("update", onUpdate));
    this.stops.push(
      this.doc.onChange(() => {
        this.revision++;
        this.synced.clear();
        this.emit();
        void this.proveSync();
      }),
    );
    this.stops.push(
      this.transport.subscribe({
        connectivity: () => this.updateStatus(),
        frame: (from, bytes) => this.enqueue(from, bytes),
        join: (peer) => {
          this.requestSync(peer);
          this.sendPresence(peer);
          this.updateStatus();
          this.emit();
        },
        leave: (peer) => {
          this.synced.delete(peer);
          this.updateStatus();
          this.emit();
        },
      }),
    );
    this.stops.push(this.clock.every(COLLAB_LIMITS.antiEntropyMs, () => this.requestSync()));
    this.stops.push(this.clock.every(COLLAB_LIMITS.partialTtlMs, () => this.reassembler.expire()));
    this.stops.push(() => this.reassembler.clear());
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
    const connectivity = next === "connected" ? "connected" : (this.transport.connectivity?.() ?? "waiting");
    const failed = ["trackers-unreachable", "no-answer", "ice-failed"].includes(connectivity);
    const changed = connectivity !== this.connectivity;
    this.connectivity = connectivity;
    if (!failed) {
      this.connectionWait?.();
      this.connectionWait = undefined;
      this.connectionFailed = false;
    } else if (!this.connectionWait && !this.connectionFailed) {
      this.connectionWait = this.clock.after(CONNECTION_WAIT_MS, () => {
        this.connectionWait = undefined;
        this.connectionFailed = true;
        this.updateStatus();
        this.emit();
      });
    }
    if (next !== this.status) {
      this.status = next;
      this.emit();
    } else if (changed) this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private reject(reason: RejectReason): void {
    this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
  }

  private requestSync(to?: PeerId): void {
    this.sendDoc(frame(DOC.syncRequest, this.doc.stateVector()), to);
    void this.proveSync(to);
  }

  private proveSync(to?: PeerId): void {
    const revision = this.revision;
    this.proofJob = this.proofJob
      .then(async () => {
        if (this.leaving || revision !== this.revision) return;
        const proof = await this.doc.syncProof();
        if (revision === this.revision && this.hasDocument && !this.leaving)
          this.sendDoc(frame(DOC.syncProof, proof), to);
      })
      .catch(() => {});
  }

  private sendPresence(to?: PeerId): void {
    this.send("presence", frame(PRESENCE.state, encodePresence(this.me)), to);
  }

  /** A document message: in one frame, or as fragments when it's larger than one. */
  private sendDoc(message: Uint8Array, to?: PeerId): void {
    if (message.length > COLLAB_LIMITS.maxMessageBytes) return this.reject("too-large");
    if (message.length <= COLLAB_LIMITS.maxFragmentBytes) return this.send("doc", message, to);
    for (const part of fragment(message, ++this.nextMessage)) this.send("doc", part, to);
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

  /**
   * Queues a frame for handling, in order. What waits is bounded (in total and per transport peer) before anything
   * is decrypted, so a flood can't pile up buffers; a frame past the bound is dropped and counted. Nothing a frame
   * does can break the queue: a failure while handling one is counted and the next is handled.
   */
  private enqueue(from: PeerId, bytes: Uint8Array): Promise<void> {
    if (this.leaving || this.status === "left") return Promise.resolve();
    const n = bytes.length;
    const fromPeer = this.queuedFrom.get(from) ?? 0;
    if (this.queuedBytes + n > COLLAB_LIMITS.maxQueuedBytes || fromPeer + n > COLLAB_LIMITS.maxQueuedBytesPerPeer) {
      this.reject("queue-full");
      return Promise.resolve();
    }
    this.queuedBytes += n;
    this.queuedFrom.set(from, fromPeer + n);
    const done = () => {
      this.queuedBytes -= n;
      const left = (this.queuedFrom.get(from) ?? n) - n;
      if (left > 0) this.queuedFrom.set(from, left);
      else this.queuedFrom.delete(from);
    };
    this.inbox = this.inbox
      .then(() => this.receive(from, bytes))
      .catch(() => this.reject("internal"))
      .finally(done);
    return this.inbox;
  }

  private async receive(from: PeerId, bytes: Uint8Array): Promise<void> {
    if (this.status === "left" || this.leaving) return;
    this.stats.framesReceived++;
    const opened = await this.opener.open(bytes);
    if (!opened.ok) return this.reject(opened.reason);
    if (this.quarantined.has(opened.sender)) return this.reject("quarantined");
    let msg = unframe(opened.plaintext);
    if (!msg) return this.reject("malformed");
    if (opened.channel === "presence") {
      const state = msg.type === PRESENCE.state ? parsePresence(msg.payload) : undefined;
      if (!state) return this.reject("malformed");
      if (this.presence.receive(opened.sender, opened.counter, state)) this.emit();
      return;
    }
    if (!this.rate.take(opened.sender, bytes.length)) return this.reject("rate-limited");
    if (msg.type === DOC.fragment) {
      const part = this.reassembler.add(opened.sender, msg.payload);
      if ("error" in part) return this.reject(part.error);
      if ("pending" in part) return;
      msg = unframe(part.done);
      if (!msg || msg.type === DOC.fragment) return this.reject("malformed");
    }
    switch (msg.type) {
      case DOC.syncProof:
      case DOC.syncAck: {
        if (msg.payload.length !== 32 || !this.hasDocument || !this.transport.peers().includes(from)) return;
        if (!this.proofs.take(opened.sender, 1)) return this.reject("proof-throttled");
        const revision = this.revision;
        const proof = await this.doc.syncProof();
        if (revision !== this.revision) return;
        if (!proof.every((b, i) => b === msg.payload[i])) {
          if (this.synced.delete(from)) this.emit();
          return;
        }
        if (this.synced.size < COLLAB_LIMITS.maxSenders) this.synced.add(from);
        if (msg.type === DOC.syncProof) this.sendDoc(frame(DOC.syncAck, proof), from);
        this.emit();
        return;
      }
      case DOC.syncRequest: {
        if (!this.requests.take(opened.sender, 1)) return this.reject("request-throttled");
        let sv: Uint8Array;
        try {
          sv = msg.payload;
          Y.decodeStateVector(sv);
        } catch {
          return this.reject("malformed");
        }
        for (const diff of this.doc.encodeDiffParts(sv, COLLAB_LIMITS.maxMessageBytes - 16)) {
          if (isEmptyUpdate(diff)) continue;
          if (this.replies.take(opened.sender, diff.length)) this.sendDoc(frame(DOC.syncReply, diff), from);
          else this.reject("reply-throttled");
        }
        if (this.doc.lacksFrom(sv)) this.requestSync(from);
        return;
      }
      case DOC.syncReply:
      case DOC.update: {
        const result = this.doc.applyRemote(msg.payload);
        if (!result.ok) {
          this.synced.delete(from);
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
