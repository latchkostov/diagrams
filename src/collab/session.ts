import * as Y from "yjs";
import { canCollaborate, type CanvasPrivacyState } from "../lib/localOnly";
import type { DiagramFile } from "../model/types";
import { realClock, type Clock } from "./clock";
import { CollabDoc, REMOTE } from "./doc";
import { FRAME_SIGNATURE_BYTES, Opener, Sealer, SENDER_ID_BYTES, type Opened, type Rejection } from "./envelope";
import { structClients, type GuardProblem } from "./guard";
import { reserveRoomCreation, deriveRoomKeys, type Channel, type RoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import {
  encodePresence,
  MAX_SELECTION,
  parsePresence,
  PresenceTable,
  randomAlias,
  type PeerPresence,
  type PresenceState,
} from "./presence";
import { DOC, frame, fragment, isEmptyUpdate, PRESENCE, Reassembler, unframe, LIVE } from "./protocol";
import { secureRandom, type RandomBytes } from "./random";
import type { CollabTransport, Connectivity, PeerId } from "./transport/types";
import { RoomRecovery } from "./recovery";
import type { RecoveryStore } from "./recoveryStore";
import { bytesToText, textToBytes } from "../interop/codec";
import type { RosterOp } from "./roster";
import { SignedRoom } from "./signedRoom";
import type { Identity } from "./signing";

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
//
// A signed room (a v2 link, P4: ./signedRoom.ts) checks more, against the roster (./roster.ts):
// - Every frame carries its sender's signature, and counts only once that verifies under the key the sender's
//   presence bound (its counter isn't recorded before, so a forged frame can't use up another sender's counters).
//   Verifications are bounded per sender (COLLAB_LIMITS.verifiesPerWindow).
// - A direct update counts only from an editor, and only with structs of the Yjs client id it bound; a sync reply
//   only from an editor. Viewers never serve sync. These depend only on bytes and the roster, never on timing.
// - What doesn't count yet (an editor's grant still on its way, a sender's binding not yet here) is held, per sender
//   and bounded (COLLAB_LIMITS.maxHeldBytesPerSender, heldMs), and never applied before it counts: once it does
//   (the roster or the binding changed) it's applied in order. Past the bounds, what was held only because this
//   session couldn't check it yet (the sender's binding late or lost, a sync reply from someone not yet known as an
//   editor) is dropped, never held against its sender: it's asked for again once it can count (a sync request as
//   the binding or the grant arrives). Only updates from a sender this session can check, that never came to count,
//   get their sender quarantined. No honest peer applies an update another honest peer refuses, so honest peers
//   can't diverge, and nothing is ever rolled back.
// - Each sync request is answered with the answerer's presence first (its binding), and a session without the
//   document says who it is with each of its own: whatever the network lost or reordered, the next anti-entropy
//   round brings both sides' bindings ahead of the document.
// - The roster travels as DOC.roster: in full to each peer that appears, each new entry to everyone, and a summary
//   with every anti-entropy round (a peer whose roster differs sends its entries back).

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
  | "presence-throttled"
  | "live-throttled"
  | "queue-full"
  | "too-many-partials"
  | "internal"
  | "malformed"
  // Signed rooms (P4):
  | "unbound"
  | "rebound"
  | "bad-binding"
  | "bad-signature"
  | "verify-throttled"
  | "unauthorised"
  | "roster-refused"
  | "held-dropped";

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
  /**
   * Asked again after the asynchronous setup (keys, recovery), just before the session sends anything: the
   * diagram may have become Private meanwhile (in another tab). False throws PrivateDiagramError.
   */
  allowed?: () => boolean;
  /** Seeds only a fresh newRoom() on its first open. A link/rejoin always merges the room's CRDT state. */
  initial?: DiagramFile;
  /** A local copy of this room's document (rejoining). */
  doc?: CollabDoc;
  clock?: Clock;
  random?: RandomBytes;
  /** For tests: deterministic Yjs client id. */
  clientId?: number;
  /**
   * A signed room's member (its link has a host key, P4): this tab's identity, and the roster entries it kept (from
   * its record: each is checked again).
   */
  signed?: { identity: Identity; log?: readonly unknown[] };
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

type Frame = Extract<Opened, { ok: true }>;

/** A signed room's document frame that doesn't count yet: still to verify, or verified and waiting for a grant. */
interface Held {
  from: PeerId;
  bytes: number;
  opened: Frame;
  /** Its message and signature (the plaintext, split). */
  message: Uint8Array;
  signature: Uint8Array;
  /** Once verified (and reassembled): the document message. */
  msg?: { type: number; payload: Uint8Array };
  /** An update's struct clients, read once (null: undecodable). */
  clients?: Set<number> | null;
  /** The roster and bindings' revision it last didn't count at. */
  checkedAt?: number;
}

/**
 * A sender's held frames: those still to verify (its binding not here yet), in order, and its verified updates and
 * sync replies that don't count yet, in order.
 */
interface HeldQueue {
  raw: Held[];
  blocked: Held[];
  bytes: number;
  stop: () => void;
}

/** What changes the document: what has to count before it's applied, in order. */
const isMutation = (msg: { type: number }) => msg.type === DOC.update || msg.type === DOC.syncReply;

/** A roster summary: which entries a peer holds (not a security check: a mismatch only asks for the entries). */
function rosterSummary(sigs: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const sig of sigs)
    for (let i = 0; i < sig.length; i++) {
      h ^= sig.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  return `${sigs.length}.${h.toString(16)}`;
}

/** A DOC.roster payload: entries, or a summary. Undefined when it isn't exactly one. */
function parseRosterMessage(payload: Uint8Array): { e: unknown[] } | { h: string } | undefined {
  if (payload.length > COLLAB_LIMITS.maxRosterMessageBytes) return undefined;
  try {
    const v = JSON.parse(bytesToText(payload)) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length !== 1) return undefined;
    if (Array.isArray(o.e)) return { e: o.e };
    if (typeof o.h === "string" && o.h.length <= 32) return { h: o.h };
    return undefined;
  } catch {
    return undefined;
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
  /** A joiner's attempt found no one: no document and no failure for COLLAB_LIMITS.noAnswerMs (reset by Retry). */
  noAnswer = false;
  private noAnswerWait?: () => void;
  /** A goodbye sealed ahead of time, so a page going away can send it at once (sealing is asynchronous). */
  private bye?: Uint8Array;
  private byeJob: Promise<void> = Promise.resolve();
  /** Document frames sealed since the goodbye was: past half a replay window, it is sealed again. */
  private framesSinceBye = 0;
  private cursorTimer?: () => void;
  private cursorSentAt = -Infinity;
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
  /** Presence frames per sender (cursors are frequent): its own bound, so they never ride free. */
  private readonly presenceRate: RateLimit;
  /** Shared Live frames per sender, likewise. */
  private readonly liveRate: RateLimit;
  private readonly liveListeners = new Set<(sender: string, from: PeerId, payload: Uint8Array) => void>();
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
  /** A signed room's state (P4): this member's identity, the roster, senders' bindings. Absent: a room without roles. */
  signed?: SignedRoom;
  /** Signature verifications per sender (frames and roster entries): each costs real work. */
  private readonly verifies: RateLimit;
  /** Full rosters sent back to a peer whose summary differs, per requester. */
  private readonly rosterReplies: RateLimit;
  /** A signed room's document frames that don't count yet, per sender (see above). */
  private readonly held = new Map<string, HeldQueue>();
  /** Senders whose frames were dropped before they could count (asked again, at their transport peer, once they can). */
  private readonly behind = new Map<string, PeerId>();
  /** Newcomers this session is admitting (an entry being signed). */
  private readonly admitting = new Set<string>();
  private summary?: string;
  /** Counts changes to the roster and to bindings: a held update that didn't count is checked again after one. */
  private authRevision = 0;
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
    this.presenceRate = new RateLimit(clock, COLLAB_LIMITS.presenceFramesPerWindow);
    this.liveRate = new RateLimit(clock, COLLAB_LIMITS.liveFramesPerWindow);
    this.verifies = new RateLimit(clock, COLLAB_LIMITS.verifiesPerWindow);
    this.rosterReplies = new RateLimit(clock, COLLAB_LIMITS.rosterRepliesPerWindow);
    this.reassembler = new Reassembler(clock);
    this.presence = new PresenceTable(clock);
  }

  /** Joins (or creates) a room. Throws PrivateDiagramError for a diagram that stays on this device. */
  static async open(opts: SessionOptions): Promise<CollabSession> {
    // The diagram's own flag too: a Private file never joins, whatever state the caller passed.
    if (!canCollaborate(opts.privacy) || opts.initial?.private || opts.privacy?.diagram?.private)
      throw new PrivateDiagramError();
    if (opts.room.hostKey && !opts.signed) throw new Error("A signed room needs this member's identity.");
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
      if (opts.allowed && !opts.allowed()) throw new PrivateDiagramError();
      if (creation && opts.initial && doc.isEmpty()) doc.hydrate(opts.initial);
      const me = { ...randomAlias(() => random(1)[0] / 256), ...opts.presence };
      session = new CollabSession(keys, opts.transport, opts.clock ?? realClock, random(SENDER_ID_BYTES), doc, me);
      if (opts.room.hostKey && opts.signed) await session.setUpSigned(opts.room.hostKey, opts.signed);
      if (opts.allowed && !opts.allowed()) throw new PrivateDiagramError();
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

  /** Whether this person may edit: always in a room without roles; in a signed one, as its roster says. */
  get canEdit(): boolean {
    return !this.signed || this.signed.canEdit;
  }

  /**
   * A signed room's roster entry by this member (a grant, a handover, the room's policy), signed and sent to
   * everyone in order with what's sent after it (a goodbye goes after a handover). False when this member may not
   * make it now, it would change nothing, or this isn't a signed room.
   */
  appendRoster(op: RosterOp, fields: { who?: string; viewOnly?: boolean } = {}): Promise<boolean> {
    const room = this.signed;
    if (!room || this.status === "left") return Promise.resolve(false);
    const job = this.outbox.then(async () => {
      const entry = await room.append(op, fields);
      if (entry) await this.deliver("doc", frame(DOC.roster, textToBytes(JSON.stringify({ e: [entry] }))));
      return !!entry;
    });
    this.outbox = job.then(
      () => {},
      () => {},
    );
    return job.catch(() => false);
  }

  /** Sets up a signed room before the session starts: its roster (from the record), its signer, its binding. */
  private async setUpSigned(hostKey: string, s: { identity: Identity; log?: readonly unknown[] }): Promise<void> {
    const room = new SignedRoom(this.keys, hostKey, s.identity);
    await room.addEntries(s.log ?? []);
    this.signed = room;
    this.sealer.sign = room.signFrame;
    await this.bind();
    room.roster.subscribe(() => (this.summary = undefined));
    room.subscribe(() => this.signedChanged());
  }

  /** This session's binding, for its sender id and its document's Yjs client id: carried by its presence. */
  private async bind(): Promise<void> {
    const room = this.signed;
    if (!room) return;
    const b = await room.bindMine(this.sealer.sender, this.doc.ydoc.clientID);
    this.me = { ...this.me, key: b.key, client: b.client, bind: b.bind };
  }

  /** The roster or a binding changed: held frames may count now, a newcomer may need admitting, the UI re-reads. */
  private signedChanged(): void {
    if (this.status === "left" || this.leaving) return;
    this.authRevision++;
    // Someone whose sync replies were dropped as not an editor's, who is one now: asked again.
    const room = this.signed;
    for (const [sender, peer] of this.behind)
      if (room?.isEditor(room.keyOf(sender))) {
        this.behind.delete(sender);
        this.requestSync(peer);
      }
    this.inbox = this.inbox.then(() => this.drainAll()).catch(() => this.reject("internal"));
    this.admitNewcomers();
    this.emit();
  }

  /**
   * While new people may edit, each newcomer here (a bound key the roster doesn't name as an editor) is admitted by
   * one person: the host if here, else the earliest co-host here (only they can admit: ../roster.ts). Until then the
   * newcomer views; with neither here, they view until one is.
   */
  private admitNewcomers(): void {
    const room = this.signed;
    if (!room || this.leaving) return;
    const s = room.state();
    if (s.viewOnly) return;
    const keyOf = (sender: string) => (sender === this.senderId ? room.key : room.keyOf(sender));
    const here = [this.senderId, ...this.presence.list().map((p) => p.sender)]
      .map((sender) => ({ sender, key: keyOf(sender) }))
      .filter((h): h is { sender: string; key: string } => !!h.key)
      .sort((a, b) => (a.sender < b.sender ? -1 : 1));
    const newcomers = [...new Set(here.filter((h) => !s.editors.has(h.key)).map((h) => h.key))];
    if (!newcomers.length) return;
    const admitter =
      here.find((h) => h.key === s.host) ?? s.cohosts.map((c) => here.find((h) => h.key === c)).find((h) => !!h);
    if (admitter?.sender !== this.senderId) return;
    for (const key of newcomers) {
      if (this.admitting.has(key)) continue;
      this.admitting.add(key);
      void this.appendRoster("admit", { who: key }).finally(() => this.admitting.delete(key));
    }
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

  /**
   * Why a joiner is still waiting (diagnostics: the wait and the chip say it): "peers" (nobody connected), "verifying"
   * (connected, but who they are hasn't checked yet, or something of theirs is waiting on it), "document" (connected
   * and checked, the diagram on its way). Undefined once it has the document.
   */
  get waiting(): "peers" | "verifying" | "document" | undefined {
    if (this.hasDocument) return undefined;
    if (!this.transport.peers().length) return "peers";
    if (this.signed && (this.held.size || this.behind.size || !this.presence.list().length)) return "verifying";
    return "document";
  }

  /** Whether this session has a document yet (a joiner has none until a peer answers). */
  get hasDocument(): boolean {
    return !this.doc.isEmpty();
  }

  peers(): PeerPresence[] {
    return this.presence.list();
  }

  /** Changes whenever what peers' presence says changes (subscribers re-read peers() then). */
  get presenceRevision(): number {
    return this.presence.revision;
  }

  /** Room-clock time, for presence's own times (a cursor's last move). */
  now(): number {
    return this.clock.now();
  }

  /** What this person has selected, for the others' outlines. Sent at once. */
  setSelection(ids: readonly string[]): void {
    const selection = ids.slice(0, MAX_SELECTION);
    const current = this.me.selection ?? [];
    if (current.length === selection.length && selection.every((id, i) => current[i] === id)) return;
    this.me = { ...this.me, selection };
    this.sendPresence();
  }

  /** Where this person's pointer is over the canvas (undefined: it left). At most 15 times a second, the last wins. */
  setCursor(cursor: { x: number; y: number } | undefined): void {
    this.me = { ...this.me, cursor };
    if (this.cursorTimer) return;
    const wait = this.cursorSentAt + COLLAB_LIMITS.cursorIntervalMs - this.clock.now();
    if (wait <= 0) {
      this.cursorSentAt = this.clock.now();
      this.sendPresence();
      return;
    }
    this.cursorTimer = this.clock.after(wait, () => {
      this.cursorTimer = undefined;
      this.cursorSentAt = this.clock.now();
      this.sendPresence();
    });
  }

  /**
   * The page is going: the goodbye goes out now, already sealed, so peers drop this person at once instead of after
   * the presence TTL (a reload otherwise leaves a second entry for 30 s).
   */
  goodbyeNow(): void {
    if (this.status === "left" || !this.bye) return;
    try {
      this.transport.send(this.bye);
    } catch {
      // Best effort: the presence TTL still removes this person.
    }
    this.bye = undefined;
  }

  /** Seals the next goodbye ahead of time (a counter of its own, well inside every receiver's replay window). */
  private prepareBye(): void {
    this.byeJob = this.byeJob
      .then(async () => {
        if (this.status === "left" || this.leaving) return;
        this.framesSinceBye = 0;
        this.bye = await this.sealer.seal("doc", frame(DOC.bye));
      })
      .catch(() => {});
  }

  retryConnection(): void {
    if (this.leaving || this.status === "left") return;
    this.connectionWait?.();
    this.connectionWait = undefined;
    this.connectionFailed = false;
    // A new attempt: its own no-answer deadline.
    this.noAnswer = false;
    this.noAnswerWait?.();
    this.noAnswerWait = undefined;
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
      this.noAnswerWait?.();
      this.noAnswerWait = undefined;
      this.cursorTimer?.();
      this.cursorTimer = undefined;
      this.bye = undefined;
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
      if (origin === REMOTE) return;
      if (this.signed) {
        // A viewer's own step (the editor refuses them first) never leaves this tab.
        if (!this.signed.canEdit) return;
        // Yjs drew another client id: bound again before the update goes (receivers hold it until then).
        if (this.doc.ydoc.clientID !== this.signed.mine?.client) this.rebind();
      }
      this.sendDoc(frame(DOC.update, update));
    };
    this.doc.ydoc.on("update", onUpdate);
    this.stops.push(() => this.doc.ydoc.off("update", onUpdate));
    this.stops.push(
      this.doc.onChange(() => {
        this.revision++;
        this.synced.clear();
        this.updateNoAnswer();
        this.emit();
        void this.proveSync();
      }),
    );
    this.stops.push(
      this.transport.subscribe({
        connectivity: () => this.updateStatus(),
        frame: (from, bytes) => this.enqueue(from, bytes),
        join: (peer) => {
          // A signed room: who this is and the roster first, so what follows counts at once.
          if (this.signed) {
            this.sendPresence(peer);
            this.sendRoster(peer);
          }
          this.requestSync(peer);
          if (!this.signed) this.sendPresence(peer);
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
    this.stops.push(
      this.clock.every(COLLAB_LIMITS.antiEntropyMs, () => {
        // Without the document yet: who this is goes with each request (a lost binding never stalls the answer).
        if (this.signed && !this.hasDocument) this.sendPresence();
        this.requestSync();
        if (this.signed) this.sendDoc(frame(DOC.roster, textToBytes(JSON.stringify({ h: this.rosterSummary() }))));
      }),
    );
    this.stops.push(() => {
      for (const q of this.held.values()) q.stop();
      this.held.clear();
    });
    this.stops.push(this.clock.every(COLLAB_LIMITS.partialTtlMs, () => this.reassembler.expire()));
    this.stops.push(() => this.reassembler.clear());
    this.stops.push(
      this.clock.every(COLLAB_LIMITS.presenceHeartbeatMs, () => {
        this.sendPresence();
        // A fresh goodbye now and then: a long session's counter never leaves receivers' replay windows behind it.
        this.prepareBye();
        if (this.presence.expire()) this.emit();
      }),
    );
    if (this.signed) this.sendPresence();
    this.requestSync();
    if (!this.signed) this.sendPresence();
    this.prepareBye();
    this.updateStatus();
  }

  /**
   * The session's connection state, in one place and in order: connectivity and its failure flag first, then the
   * no-answer deadline (which reads that flag), then one notification.
   */
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
    const answered = this.noAnswer;
    this.updateNoAnswer();
    if (next !== this.status) {
      this.status = next;
      this.emit();
    } else if (changed || answered !== this.noAnswer) this.emit();
  }

  /** A joiner without a document and without a failure waits COLLAB_LIMITS.noAnswerMs, once per attempt. */
  private updateNoAnswer(): void {
    const waiting = !this.hasDocument && !this.connectionFailed;
    if (!waiting) {
      this.noAnswerWait?.();
      this.noAnswerWait = undefined;
      this.noAnswer = false;
      return;
    }
    if (this.noAnswer || this.noAnswerWait) return;
    this.noAnswerWait = this.clock.after(COLLAB_LIMITS.noAnswerMs, () => {
      this.noAnswerWait = undefined;
      if (this.hasDocument || this.connectionFailed || this.status === "left") return;
      this.noAnswer = true;
      this.emit();
    });
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

  /** A shared Live message (src/collab/room/liveShare.ts): to everyone, or to one transport peer. False: too large. */
  sendLive(payload: Uint8Array, to?: PeerId): boolean {
    const signature = this.signed ? FRAME_SIGNATURE_BYTES : 0;
    if (1 + payload.length + 48 + signature > COLLAB_LIMITS.maxLiveFrameBytes) return false;
    this.send("live", frame(LIVE.message, payload), to);
    return true;
  }

  /** Shared Live messages from others, with their sender (as presence names them) and transport peer. */
  onLive(listener: (sender: string, from: PeerId, payload: Uint8Array) => void): () => void {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
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
    this.outbox = this.outbox.then(() => this.deliver(channel, plaintext, to));
  }

  /** Seals one frame and hands it to the transport (a step of the outbox: in order with everything else). */
  private async deliver(channel: Channel, plaintext: Uint8Array, to?: PeerId): Promise<void> {
    try {
      const sealed = await this.sealer.seal(channel, plaintext);
      // Every receiver keeps a window of a sender's counters: the cached goodbye stays well inside it.
      if (channel === "doc" && ++this.framesSinceBye >= COLLAB_LIMITS.replayWindow / 2) this.prepareBye();
      if (this.status === "left") return;
      this.transport.send(sealed, to);
      this.stats.framesSent++;
      this.stats.bytesSent += sealed.length;
    } catch {
      this.reject("too-large");
    }
  }

  /** Bound again (a new Yjs client id), and said, before anything queued after it. */
  private rebind(): void {
    this.outbox = this.outbox.then(async () => {
      try {
        await this.bind();
      } catch {
        return this.reject("internal");
      }
      await this.deliver("presence", frame(PRESENCE.state, encodePresence(this.me)));
    });
  }

  /** This session's roster entries, to one peer (it just appeared, or its summary differs). */
  private sendRoster(to?: PeerId): void {
    const log = this.signed?.roster.log();
    if (log?.length) this.sendDoc(frame(DOC.roster, textToBytes(JSON.stringify({ e: log }))), to);
  }

  private rosterSummary(): string {
    return (this.summary ??= rosterSummary(this.signed?.roster.log().map((e) => e.sig) ?? []));
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
    const opened = await this.opener.open(bytes, !!this.signed);
    if (!opened.ok) return this.reject(opened.reason);
    if (this.quarantined.has(opened.sender)) return this.reject("quarantined");
    if (this.signed) return this.receiveSigned(from, bytes, opened);
    let msg = unframe(opened.plaintext);
    if (!msg) return this.reject("malformed");
    if (opened.channel === "live") {
      if (!this.liveRate.take(opened.sender, 1)) return this.reject("live-throttled");
      if (msg.type !== LIVE.message) return this.reject("malformed");
      for (const listener of this.liveListeners) listener(opened.sender, from, msg.payload);
      return;
    }
    if (opened.channel === "presence") {
      if (!this.presenceRate.take(opened.sender, 1)) return this.reject("presence-throttled");
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
    return this.handleDoc(from, opened.sender, msg);
  }

  /** A signed room's frame (see above): its signature, its sender's binding, and (document frames) the roster. */
  private async receiveSigned(from: PeerId, bytes: Uint8Array, opened: Frame): Promise<void> {
    const room = this.signed!;
    const sender = opened.sender;
    const cut = opened.plaintext.length - FRAME_SIGNATURE_BYTES;
    if (cut < 1) return this.reject("malformed");
    const message = opened.plaintext.subarray(0, cut);
    const signature = opened.plaintext.subarray(cut);
    if (opened.channel === "presence") {
      if (!this.presenceRate.take(sender, 1)) return this.reject("presence-throttled");
      const msg = unframe(message);
      const state = msg?.type === PRESENCE.state ? parsePresence(msg.payload) : undefined;
      if (!state) return this.reject("malformed");
      if (!state.key || state.client === undefined || !state.bind) return this.reject("unbound");
      const held = room.keyOf(sender);
      if (held && held !== state.key) return this.reject("rebound");
      if (!this.verifies.take(sender, held === state.key && room.clientOf(sender) === state.client ? 1 : 2))
        return this.reject("verify-throttled");
      if (!(await room.verifyFrame(state.key, opened.header, message, signature))) return this.reject("bad-signature");
      const bound = await room.bindPeer(
        sender,
        opened.senderBytes,
        { key: state.key, client: state.client, bind: state.bind },
        opened.counter,
      );
      if (bound === "rebound" || bound === "bad-binding") return this.reject(bound);
      const accepted = this.opener.accept(opened);
      if (accepted !== true) return this.reject(accepted);
      // A sender bound just now: if anything of theirs was dropped unchecked, or this session still lacks the
      // document, it asks them for it at once (what's held is applied as the binding drains it).
      if (bound === "bound" && (this.behind.has(sender) || !this.hasDocument)) {
        this.behind.delete(sender);
        this.requestSync(from);
      }
      if (this.presence.receive(sender, opened.counter, state)) {
        this.emit();
        this.admitNewcomers();
      }
      return;
    }
    if (opened.channel === "live") {
      if (!this.liveRate.take(sender, 1)) return this.reject("live-throttled");
      const key = room.keyOf(sender);
      if (!key) return this.reject("unbound");
      if (!this.verifies.take(sender, 1)) return this.reject("verify-throttled");
      if (!(await room.verifyFrame(key, opened.header, message, signature))) return this.reject("bad-signature");
      const accepted = this.opener.accept(opened);
      if (accepted !== true) return this.reject(accepted);
      const msg = unframe(message);
      if (msg?.type !== LIVE.message) return this.reject("malformed");
      for (const listener of this.liveListeners) listener(sender, from, msg.payload);
      return;
    }
    if (!this.rate.take(sender, bytes.length)) return this.reject("rate-limited");
    const item: Held = { from, bytes: bytes.length, opened, message, signature };
    // A sender with frames held: this one goes behind them (their order matters), and they go as far as they can.
    const q = this.held.get(sender);
    // Not bound yet (or frames before this one aren't verified yet): it waits, in order, for the binding.
    if (!room.keyOf(sender) || q?.raw.length) return this.hold(sender, item, "raw");
    if (!(await this.open(item))) return;
    // The roster and sync messages never wait (one may carry the grant an update waits for).
    if (!isMutation(item.msg!)) return this.handleDoc(from, sender, item.msg!);
    // Behind updates that don't count yet: in order, checked again when the roster or a binding changes (not now).
    if (q?.blocked.length) return this.hold(sender, item, "blocked");
    if (this.counts(sender, item)) return this.handleDoc(from, sender, item.msg!);
    item.checkedAt = this.authRevision;
    this.hold(sender, item, "blocked");
  }

  /**
   * A document frame from a bound sender, verified and opened: its counter recorded, its fragments put together.
   * False when there's nothing (more) to do with it: refused, or a part of a message still incomplete.
   */
  private async open(item: Held): Promise<boolean> {
    const room = this.signed!;
    const sender = item.opened.sender;
    if (!this.verifies.take(sender, 1)) {
      this.reject("verify-throttled");
      return false;
    }
    if (!(await room.verifyFrame(room.keyOf(sender)!, item.opened.header, item.message, item.signature))) {
      this.reject("bad-signature");
      return false;
    }
    const accepted = this.opener.accept(item.opened);
    if (accepted !== true) {
      this.reject(accepted);
      return false;
    }
    let msg = unframe(item.message);
    if (!msg) {
      this.reject("malformed");
      return false;
    }
    if (msg.type === DOC.fragment) {
      const part = this.reassembler.add(sender, msg.payload);
      if ("error" in part) {
        this.reject(part.error);
        return false;
      }
      if ("pending" in part) return false;
      msg = unframe(part.done);
      if (!msg || msg.type === DOC.fragment) {
        this.reject("malformed");
        return false;
      }
    }
    item.msg = msg;
    this.resize(sender, item, msg.payload.length);
    return true;
  }

  /**
   * Whether a verified update or sync reply counts now: a direct update from an editor, with structs of its own
   * bound client id only (read once per held update); a sync reply from an editor.
   */
  private counts(sender: string, item: Held): boolean {
    const room = this.signed!;
    if (!room.isEditor(room.keyOf(sender))) return false;
    if (item.msg!.type === DOC.syncReply) return true;
    // Undecodable: it counts, and the guard refuses it (its sender quarantined, as ever).
    if (item.clients === undefined) item.clients = this.updateClients(item.msg!.payload);
    const own = room.clientOf(sender);
    return !item.clients || [...item.clients].every((c) => c === own);
  }

  /** An update's struct clients (decoded once per held update: it's cached on the item). */
  private updateClients(payload: Uint8Array): Set<number> | null {
    return structClients(payload) ?? null;
  }

  private resize(_sender: string, item: Held, bytes: number): void {
    item.bytes = bytes;
  }

  /** Holds a frame that doesn't count yet; past the bounds, its sender's held frames go, and the sender with them. */
  private hold(sender: string, item: Held, where: "raw" | "blocked"): void {
    let q = this.held.get(sender);
    if (!q) {
      if (this.held.size >= COLLAB_LIMITS.maxSenders) return this.reject("unauthorised");
      q = { raw: [], blocked: [], bytes: 0, stop: this.clock.after(COLLAB_LIMITS.heldMs, () => this.giveUp(sender)) };
      this.held.set(sender, q);
    }
    if (q.bytes + item.bytes > COLLAB_LIMITS.maxHeldBytesPerSender) {
      // Past the bound: something this session couldn't check yet (unbound, or a sync reply) is dropped and asked
      // for again later; an update that doesn't count from a sender it can check gives the sender up.
      if (where === "raw" || item.msg?.type !== DOC.update) return this.drop(sender, item.from);
      return this.giveUp(sender, 1);
    }
    q[where].push(item);
    q.bytes += item.bytes;
  }

  /** A frame dropped before it could count: never held against its sender; asked for again once it can count. */
  private drop(sender: string, from: PeerId, count = 1): void {
    for (let i = 0; i < count; i++) this.reject("held-dropped");
    this.behind.set(sender, from);
    if (this.behind.size > COLLAB_LIMITS.maxSenders) this.behind.delete(this.behind.keys().next().value!);
  }

  /**
   * Held too long. Updates from a sender this session could check, that never came to count (a viewer's edit, say),
   * give the sender up: dropped, and the sender quarantined. Anything else (frames held because the sender's binding
   * hadn't come, sync replies from someone not known as an editor yet) is just dropped, and asked for again.
   */
  private giveUp(sender: string, extra = 0): void {
    const q = this.held.get(sender);
    q?.stop();
    this.held.delete(sender);
    const updates = q?.blocked.filter((i) => i.msg?.type === DOC.update).length ?? 0;
    if (!updates && !extra) {
      const last = q?.raw.at(-1) ?? q?.blocked.at(-1);
      if (last) this.drop(sender, last.from, q!.raw.length + q!.blocked.length);
      return;
    }
    for (let i = 0; i < (q ? q.raw.length + q.blocked.length : 0) + extra; i++) this.reject("unauthorised");
    this.quarantine(sender);
  }

  private quarantine(sender: string, from?: PeerId): void {
    if (from) this.synced.delete(from);
    this.quarantined.add(sender);
    if (this.presence.remove(sender)) this.emit();
  }

  /**
   * A sender's held frames, as far as they go now (the roster or a binding changed). Frames waiting for the
   * sender's binding are verified in order once it's here: roster and sync messages among them are handled at once,
   * updates join the blocked ones. Then the blocked updates, in order, each once it counts; the first that doesn't
   * stops the rest, and it's checked again only after the next change (constant work per change, whatever's held).
   */
  private async drain(sender: string): Promise<void> {
    const q = this.held.get(sender);
    const room = this.signed;
    if (!q || !room) return;
    const current = () => this.held.get(sender) === q && !this.leaving;
    while (q.raw.length && room.keyOf(sender) && current()) {
      const item = q.raw.shift()!;
      q.bytes -= item.bytes;
      if (!(await this.open(item))) continue;
      if (!isMutation(item.msg!)) await this.handleDoc(item.from, sender, item.msg!);
      else if (current()) {
        q.blocked.push(item);
        q.bytes += item.bytes;
      }
    }
    while (q.blocked.length && current()) {
      const item = q.blocked[0];
      if (item.checkedAt === this.authRevision) break;
      item.checkedAt = this.authRevision;
      if (!this.counts(sender, item)) break;
      q.blocked.shift();
      q.bytes -= item.bytes;
      await this.handleDoc(item.from, sender, item.msg!);
    }
    if (this.held.get(sender) === q && !q.raw.length && !q.blocked.length) {
      q.stop();
      this.held.delete(sender);
    }
  }

  private async drainAll(): Promise<void> {
    for (const sender of [...this.held.keys()]) await this.drain(sender);
  }

  /** One whole document message from an authenticated sender (in a signed room: one that counts). */
  private async handleDoc(from: PeerId, sender: string, msg: { type: number; payload: Uint8Array }): Promise<void> {
    const opened = { sender };
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
        // A signed room's viewers never serve sync (only an editor's reply counts anywhere).
        const serves = !this.signed || this.signed.isEditor(this.signed.key);
        // Who this is, ahead of the answer on the same ordered channel: the binding the reply is checked against.
        if (this.signed) this.sendPresence(from);
        let sv: Uint8Array;
        try {
          sv = msg.payload;
          Y.decodeStateVector(sv);
        } catch {
          return this.reject("malformed");
        }
        for (const diff of serves ? this.doc.encodeDiffParts(sv, COLLAB_LIMITS.maxMessageBytes - 16) : []) {
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
          this.quarantine(opened.sender, from);
          this.reject(result.problem);
        }
        return;
      }
      case DOC.roster: {
        const room = this.signed;
        const body = room && parseRosterMessage(msg.payload);
        if (!room || !body) return this.reject("malformed");
        if ("h" in body) {
          // A peer whose roster differs: this one's entries, at most a few times a window.
          if (body.h !== this.rosterSummary() && room.roster.size && this.rosterReplies.take(opened.sender, 1))
            this.sendRoster(from);
          return;
        }
        const added = await room.addEntries(body.e, () => this.verifies.take(opened.sender, 1));
        for (let i = 0; i < added.refused; i++) this.reject("roster-refused");
        for (let i = 0; i < added.throttled; i++) this.reject("verify-throttled");
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
