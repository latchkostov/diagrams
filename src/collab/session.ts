import * as Y from "yjs";
import { canCollaborate, type CanvasPrivacyState } from "../lib/localOnly";
import type { DiagramFile } from "../model/types";
import { realClock, type Clock } from "./clock";
import { CollabDoc, REMOTE } from "./doc";
import {
  frameChannel,
  FRAME_SIGNATURE_BYTES,
  Opener,
  Sealer,
  SENDER_ID_BYTES,
  type Opened,
  type Rejection,
} from "./envelope";
import { ChainCatchUp } from "./chainCatchUp";
import { structClients, type GuardProblem } from "./guard";
import {
  checkMemberProof,
  deriveEpochKeys,
  deriveRoomKeys,
  memberProof,
  newEpochSecret,
  reserveRoomCreation,
  type Channel,
  type RoomKeys,
} from "./keys";
import { commitEpoch, EpochChain, MAX_EPOCHS, scopeOf, signStart, type ChainData, type EpochStart } from "./epochs";
import {
  Buckets,
  chainMessages,
  Lobby,
  unwrap,
  wrapFor,
  wrapSigned,
  type LobbyBody,
  type LobbyMessage,
  type Wrap,
} from "./lobby";
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
import { base64UrlToBytes, bytesToBase64Url, bytesToText, textToBytes } from "../interop/codec";
import type { RosterEntry, RosterOp } from "./roster";
import { SignedRoom } from "./signedRoom";
import type { Agreement, Identity } from "./signing";

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
//
// A knock-to-join room (a v3 link, P5: ./lobby.ts, ./epochs.ts) adds a lobby, sealed under the link's key:
// - The content is under the current epoch's secret. Content frames go only to transport peers whose lobby hello
//   proved they hold it (a member proof), and only members' presence and frames count: someone who knocks gets
//   nothing of the room, and can't ask for it.
// - A knock (a hello without that proof) from someone who isn't a member is shown to the host and co-hosts (Admit or
//   Deny), or, with "ask" off, the host's (else the earliest co-host's) page lets them in. Letting in is a signed join
//   entry, then a bundle to them: the room's epochs and the secret, wrapped for their key-agreement key.
// - A member behind on epochs (back from a reload, or across a partition) is sent what it lacks; one no longer in the
//   room (removed) is told so by the chain itself, and leaves.
// - Remove: a signed removal, then a new epoch: a new secret, its start signed by the remover and committing to it,
//   wrapped for each member left (absent ones too: kept and sent when they're back), and the session re-keyed in
//   place (the same document, sender and Live run). Frames from any other epoch are refused.

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
  // Knock-to-join (P5):
  | "not-member"
  | "bad-proof"
  | "bad-channel"
  | "lobby-throttled"
  | "bad-agreement"
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
  signed?: { identity: Identity; log?: readonly unknown[]; knock?: KnockMember };
  presence?: Partial<PresenceState>;
}

/** A knock-to-join room's member (v3): its key-agreement key, the room's epochs, and the current one's secret. */
export interface KnockMember {
  agreement: Agreement;
  chain: ChainData;
  /** The epoch it's in (its scope): the record's; absent, the chain's deepest. */
  scope?: string;
  /** The current epoch's secret. Absent: this person is at the door, knocking, until someone lets them in. */
  secret?: Uint8Array;
  /** Wrapped secrets it holds for others (a re-key's, kept to hand to members who come back). */
  wraps?: Wrap[];
}

/** Someone at the door, as the host and co-hosts see them. */
export interface Knock {
  key: string;
  x: string;
  alias: string;
  peer: PeerId;
  sender: string;
  /** Room-clock time it was last said. */
  at: number;
}

/** Knocks shown at most (one per transport peer), and how long one lasts without being said again. */
const MAX_KNOCKS = 8;
export const KNOCK_TTL_MS = 60_000;
/** Wrapped secrets a member keeps for others. */
const MAX_KEPT_WRAPS = 64;

/** A token bucket per sender on the room clock: `cap` bytes per window. */
/** Token buckets per sender (or peer) on the room clock: bounded, idle ones going first (./lobby.ts). */
class RateLimit extends Buckets {
  constructor(clock: Clock, cap: number) {
    super(clock, cap, 1024);
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
  /** When this session last asked each peer for what it lacks (a full sync request), until the peer replies. */
  private readonly asked = new Map<PeerId, number>();
  private revision = 0;
  private elementIds = 0;

  private sealer: Sealer;
  private opener: Opener;
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
  /** Knock-to-join: the key each proved transport peer proved (this epoch), and whether this page has committed a
   *  roster entry since its last re-key (one its members may not have had, if they haven't proved themselves yet). */
  private readonly provedKeys = new Map<PeerId, string>();
  /** A chain decision asked for and not yet made (decideOnChain). */
  private chainDecision = false;
  private committedSinceRekey = false;
  /** Leaving, with roster writes already asked for still to finish: nothing new comes in or is asked for. */
  private closing = false;
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
  /** Knock-to-join: newcomers an Admit is under way for (their card gone; a Deny can't overtake it). */
  private readonly lettingIn = new Set<string>();
  private summary?: string;
  /** Knock-to-join: the lobby, its keys, the recovery store (a new epoch writes under its own key). */
  private lobby?: Lobby;
  private lobbyKeys?: RoomKeys;
  private recoveryStore?: RecoveryStore;
  /** Transport peers whose hello proved they hold this epoch's secret (content goes to them only), by sender. */
  private readonly memberPeers = new Map<PeerId, string>();
  /** People knocking (shown to the host and co-hosts), by key. */
  readonly knocks = new Map<string, Knock>();
  /** Wrapped secrets this member holds (the current epoch's, for members who come back). */
  private wraps: Wrap[] = [];
  /** The current epoch's scope. */
  private scope = "";
  /** Bundles sent to one peer per window (a member behind on epochs asks again and again). */
  private readonly bundles: RateLimit;
  /** This person was removed from the room (the session has left). */
  removed = false;
  /** Knock-to-join: this person is at the door, waiting for the host or a co-host to let them in. */
  knocking = false;
  /** They said no (the session has left). */
  denied = false;
  /** Scopes this session has sealed content under: it never moves to one again (nor back to an older epoch). */
  private readonly sealedScopes = new Set<string>();
  /** At the door, a member answered (someone's here and has been asked): waiting to be let in, not for an answer. */
  private readonly answeredBy = new Set<PeerId>();
  /** At the door: wraps for this person whose epoch hasn't arrived yet, and a no waiting for its chain. */
  private pendingWraps: Wrap[] = [];
  /** Keys this host or co-host said no to, and when (oldest first, a few). */
  private readonly denials = new Map<string, number>();
  private pendingDeny?: { by: string; tip?: string };
  /**
   * The chains peers have said they're sending (each piece names the epoch it reaches): nothing irreversible (leaving
   * as removed, knocking again, taking a no) is decided while one's still to arrive (./chainCatchUp.ts).
   */
  private readonly catchUp = new ChainCatchUp();
  /** At the door, a member here answered (someone's here and has been asked): until they've all gone. */
  get lobbyAnswered(): boolean {
    return this.answeredBy.size > 0;
  }
  /** Counts changes to the roster and to bindings: a held update that didn't count is checked again after one. */
  private authRevision = 0;
  private outbox: Promise<void> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();
  private proofJob: Promise<void> = Promise.resolve();
  private stops: (() => void)[] = [];
  private listeners = new Set<() => void>();

  private constructor(
    public keys: RoomKeys,
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
    this.bundles = new RateLimit(clock, COLLAB_LIMITS.rosterRepliesPerWindow);
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
      const lobbyKeys = await deriveRoomKeys(opts.room);
      let keys = lobbyKeys;
      let chain: EpochChain | undefined;
      let current: EpochStart | undefined;
      if (opts.room.knock) {
        const k = opts.signed?.knock;
        if (!k || !opts.room.hostKey) throw new Error("A knock-to-join room needs its epoch's secret.");
        chain = new EpochChain(opts.room.hostKey, lobbyKeys.roomId);
        await chain.add(k.chain);
        if (k.secret) {
          current = (k.scope && chain.byScope(k.scope)) || chain.deepest();
          if (!current || !(await chain.learn(current, k.secret)))
            throw new Error("That isn't this room's epoch secret.");
          keys = await deriveEpochKeys(lobbyKeys, current.epoch, k.secret);
        } else {
          // At the door: content keys of its own that nobody else has (it sends no content to anyone anyway), until
          // it's let in and follows the room's epoch.
          keys = await deriveEpochKeys(lobbyKeys, 0, random(32));
        }
      }
      doc ??= new CollabDoc({ clientId: opts.clientId });
      // At the door there's no local copy to read or write: its keys aren't the room's (./rekey makes one once in).
      const atDoor = !!opts.room.knock && !current;
      const recovery =
        opts.recovery && !atDoor
          ? new RoomRecovery(
              opts.recovery,
              keys,
              () => session?.emit(),
              Date.now,
              opts.clock ?? realClock,
              current && scopeOf(current),
            )
          : undefined;
      await recovery?.restore(doc);
      if (opts.allowed && !opts.allowed()) throw new PrivateDiagramError();
      if (creation && opts.initial && doc.isEmpty()) doc.hydrate(opts.initial);
      const me = { ...randomAlias(() => random(1)[0] / 256), ...opts.presence };
      session = new CollabSession(keys, opts.transport, opts.clock ?? realClock, random(SENDER_ID_BYTES), doc, me);
      if (opts.room.hostKey && opts.signed)
        await session.setUpSigned(opts.room.hostKey, opts.signed, chain && { lobbyKeys, chain, current });
      session.recoveryStore = opts.recovery;
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
  appendRoster(
    op: RosterOp,
    fields: { who?: string; viewOnly?: boolean; x?: string; ask?: boolean } = {},
  ): Promise<boolean> {
    const room = this.signed;
    if (!room || this.status === "left" || this.closing) return Promise.resolve(false);
    return room.transact(() => this.commitEntry(op, fields)).catch(() => false);
  }

  /**
   * Inside a roster transaction: the entry signed, kept and sent to everyone, in its place among what's sent (a
   * goodbye goes after a handover, a grant before the handoff it makes count).
   */
  private commitEntry(
    op: RosterOp,
    fields: { who?: string; viewOnly?: boolean; x?: string; ask?: boolean } = {},
  ): Promise<boolean> {
    const room = this.signed!;
    const job = this.outbox.then(async () => {
      const entry = await room.append(op, fields);
      if (!entry) return false;
      this.committedSinceRekey = true;
      await this.deliver("doc", frame(DOC.roster, textToBytes(JSON.stringify({ e: [entry] }))));
      return true;
    });
    this.outbox = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  /** Sets up a signed room before the session starts: its roster (from the record), its signer, its binding. */
  private async setUpSigned(
    hostKey: string,
    s: { identity: Identity; log?: readonly unknown[]; knock?: KnockMember },
    knock?: { lobbyKeys: RoomKeys; chain: EpochChain; current?: EpochStart },
  ): Promise<void> {
    const room = new SignedRoom(
      this.keys,
      hostKey,
      s.identity,
      knock && s.knock ? { chain: knock.chain, agreement: s.knock.agreement } : undefined,
    );
    if (knock && s.knock) {
      this.lobbyKeys = knock.lobbyKeys;
      this.lobby = new Lobby(knock.lobbyKeys, s.identity, this.sealer.sender, this.clock);
      // Members' senders (and the host's) take members' places in the lobby; everyone else a guest's.
      this.lobby.isMember = (key) => key === hostKey || room.state().members.has(key);
      this.wraps = s.knock.wraps ?? [];
      this.knocking = !s.knock.secret;
      if (knock.current) {
        room.current = knock.current;
        this.sealedScopes.add(scopeOf(knock.current));
      }
      this.scope = room.scope;
    } else await room.addEntries(s.log ?? []);
    this.signed = room;
    this.sealer.sign = room.signFrame;
    await this.bind();
    room.subscribe(() => {
      this.summary = undefined;
      this.signedChanged();
    });
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
    // Who's at the door is asked of the host and co-hosts only: no longer one, the knocks go.
    const s = room?.state();
    if (this.knocks.size && s && !(s.host === room!.key || s.cohosts.includes(room!.key))) this.knocks.clear();
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
    const keyOf = (sender: string) => (sender === this.senderId ? room.key : room.identityOf(sender));
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
    const peers = this.roomPeers();
    if (peers.length && peers.every((peer) => this.synced.has(peer)) && this.hasDocument) return "synced";
    if (this.recovery?.saved) return "saved-device";
    return this.status === "connected" || !this.hasDocument ? "connecting" : "offline";
  }

  /**
   * Why a joiner is still waiting (diagnostics: the wait and the chip say it): "peers" (nobody connected), "verifying"
   * (connected, but who they are hasn't checked yet, or something of theirs is waiting on it), "document" (connected
   * and checked, the diagram on its way). Undefined once it has the document.
   */
  get waiting(): "peers" | "admission" | "verifying" | "document" | undefined {
    if (this.hasDocument) return undefined;
    // Knock-to-join: at the door, asked (someone's here), or still looking for anyone.
    if (this.knocking) return this.lobbyAnswered ? "admission" : "peers";
    if (!this.roomPeers().length && !this.transport.peers().length) return "peers";
    if (this.signed && (this.held.size || this.behind.size || !this.presence.list().length)) return "verifying";
    return "document";
  }

  /**
   * One snapshot of this session's state for diagnostics (the wait and the chip carry it as data attributes, and e2e
   * builds expose it): why it waits, its epoch, who's here, and what it refused, by reason.
   */
  diagnostics(): {
    waiting: string;
    knocking: boolean;
    epoch: number;
    peers: number;
    held: number;
    behind: number;
    rejected: Partial<Record<RejectReason, number>>;
  } {
    return {
      waiting: this.waiting ?? "none",
      knocking: this.knocking,
      epoch: this.keys.epoch,
      peers: this.peerCount,
      held: this.held.size,
      behind: this.behind.size,
      rejected: { ...this.stats.rejected },
    };
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
      const [o, i, p, r] = [this.outbox, this.inbox, this.proofJob, this.signed?.settled];
      await Promise.all([o, i, p, r]);
      if (o === this.outbox && i === this.inbox && p === this.proofJob && r === this.signed?.settled) return;
    }
  }

  /** Leaves: says goodbye, stops timers and the transport. The local document stays (a local copy). */
  leave(): Promise<void> {
    return (this.leaveJob ??= this.finishLeaving());
  }

  private async finishLeaving(): Promise<void> {
    if (this.status === "left" || this.leaving || this.closing) return;
    // Closing: nothing new is taken (frames in, new roster writes); roster writes already asked for (a removal and its
    // re-key, then the handover as the host leaves, in the epoch that left it in) finish first. Then the goodbye.
    this.closing = true;
    const room = this.signed;
    await room?.settled;
    // An entry since the last re-key (a handover as the host leaves) that a member may not have had: content frames go
    // only to members proved in this epoch, and one hasn't (a re-key just now; or away). The chain (the entry in it) to
    // everyone in the lobby before this page goes. With every member proved, the entry went to them all.
    if (room?.knock && room.current && this.committedSinceRekey) {
      const proved = new Set(this.provedKeys.values());
      if ([...room.state().members].some((k) => k !== room.key && !proved.has(k)))
        await this.sendLobby(chainMessages(room.knock.chain.data(room.current), []));
    }
    this.leaving = true;
    try {
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
          // Knock-to-join: who this is first; the room's content only once each side has proved it's a member.
          if (this.lobby) {
            this.sayHello(peer);
            this.updateStatus();
            this.emit();
            return;
          }
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
          this.memberPeers.delete(peer);
          this.provedKeys.delete(peer);
          // The last member who answered a knock gone: waiting for an answer again (the no-answer wait restarts).
          this.answeredBy.delete(peer);
          this.asked.delete(peer);
          this.lobby?.forget(peer);
          for (const [key, k] of this.knocks) if (k.peer === peer) this.knocks.delete(key);
          this.synced.delete(peer);
          this.updateStatus();
          this.emit();
        },
      }),
    );
    this.stops.push(
      this.clock.every(COLLAB_LIMITS.antiEntropyMs, () => {
        this.expireKnocks();
        // A chain promised and still not here (or its wait run out): what waited on it is looked at again.
        if (this.lobby && (this.pendingDeny || this.catchUp.size)) this.decideOnChain();
        // Anyone not yet proved a member (a hello lost, a peer behind on epochs) hears from this one again.
        if (this.lobby) for (const peer of this.transport.peers()) if (!this.memberPeers.has(peer)) this.sayHello(peer);
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
    this.stops.push(
      this.clock.every(COLLAB_LIMITS.partialTtlMs, () => {
        this.reassembler.expire();
        this.lobby?.expire();
      }),
    );
    this.stops.push(() => {
      this.reassembler.clear();
      this.lobby?.clear();
    });
    this.stops.push(
      this.clock.every(COLLAB_LIMITS.presenceHeartbeatMs, () => {
        this.sendPresence();
        // A fresh goodbye now and then: a long session's counter never leaves receivers' replay windows behind it.
        this.prepareBye();
        if (this.presence.expire()) this.emit();
      }),
    );
    if (this.lobby) this.sayHello();
    if (this.signed) this.sendPresence();
    // Everyone here already asked as they appeared (subscribing names those already connected): once is enough.
    if (this.roomPeers().some((p) => !this.asked.has(p))) this.requestSync();
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
    const next: SessionStatus = this.roomPeers().length ? "connected" : "waiting";
    const connectivity = next === "connected" ? "connected" : (this.transport.connectivity?.() ?? "waiting");
    const failed = ["trackers-unreachable", "no-answer", "ice-failed", "server-unreachable", "room-full"].includes(
      connectivity,
    );
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
    // At the door with someone here who's been asked: waiting to be let in, not for an answer.
    const waiting = !this.hasDocument && !this.connectionFailed && !(this.knocking && this.lobbyAnswered);
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

  /** Whether a full sync request this session sent `peer` is still to be answered (and recent: it may have been lost). */
  private awaiting(peer: PeerId): boolean {
    const at = this.asked.get(peer);
    return at !== undefined && this.clock.now() - at < COLLAB_LIMITS.antiEntropyMs;
  }

  private requestSync(to?: PeerId): void {
    const now = this.clock.now();
    for (const peer of to === undefined ? this.roomPeers() : [to]) this.asked.set(peer, now);
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
      // Knock-to-join: the room's content only to proved members, never to someone at the door.
      const targets = !this.lobby
        ? [to]
        : to === undefined
          ? [...this.memberPeers.keys()]
          : this.memberPeers.has(to)
            ? [to]
            : [];
      for (const target of targets) {
        this.transport.send(sealed, target);
        this.stats.framesSent++;
        this.stats.bytesSent += sealed.length;
      }
    } catch {
      this.reject("too-large");
    }
  }

  /** How many others are in the room (with knock-to-join: proved members, never someone at the door). */
  get peerCount(): number {
    return this.roomPeers().length;
  }

  /** Transport peers in the room: all of them, or with knock-to-join the proved members. */
  private roomPeers(): PeerId[] {
    return this.lobby ? [...this.memberPeers.keys()] : [...this.transport.peers()];
  }

  // ---------------------------------------------------------------- knock-to-join (P5)

  /** A lobby message, signed and sealed, in order with everything else this session sends. */
  private sendLobby(
    body: LobbyBody | LobbyBody[] | (() => Promise<LobbyBody | LobbyBody[]>),
    to?: PeerId,
  ): Promise<boolean> {
    const lobby = this.lobby;
    if (!lobby || this.status === "left") return Promise.resolve(false);
    const job = this.outbox.then(async () => {
      try {
        const made = typeof body === "function" ? await body() : body;
        for (const message of Array.isArray(made) ? made : [made]) this.sendFrames(await lobby.seal(message), to);
        return true;
      } catch {
        this.reject("too-large");
        return false;
      }
    });
    this.outbox = job.then(() => {});
    return job;
  }

  /** Lobby frames already sealed, to one peer or everyone. */
  private sendFrames(frames: Uint8Array[], to?: PeerId): void {
    for (const f of frames) {
      if (this.status === "left") return;
      this.transport.send(f, to);
      this.stats.framesSent++;
      this.stats.bytesSent += f.length;
    }
  }

  /** Who this is, and the proof it holds this epoch's secret. */
  private sayHello(to?: PeerId): void {
    const room = this.signed;
    if (!room?.knock) return;
    // At the door: who this is, and nothing else (a knock).
    if (this.knocking) {
      this.sendLobby({ t: "hello", x: room.knock.agreement.x, alias: this.me.alias }, to);
      return;
    }
    this.sendLobby(
      async () => ({
        t: "hello",
        x: room.knock!.agreement.x,
        alias: this.me.alias,
        scope: this.scope,
        proof: bytesToBase64Url(await memberProof(this.keys, this.sealer.sender)),
      }),
      to,
    );
  }

  /** A lobby frame: a hello (a member, or a knock), a bundle (epochs, secrets), a deny (for knockers only). */
  private async receiveLobby(from: PeerId, bytes: Uint8Array): Promise<void> {
    const lobby = this.lobby!;
    const m = await lobby.open(from, bytes);
    if (!m) {
      if (lobby.refused) this.reject(lobby.refused as RejectReason);
      return;
    }
    if (m.sender === this.senderId) return;
    if (m.body.t === "hello") return this.lobbyHello(m, m.body);
    if (m.body.t === "bundle") return this.lobbyBundle(m, m.body);
    if (m.body.t === "deny") return this.lobbyDeny(m, m.body);
  }

  /** At the door, told no: only the host's or a co-host's no counts (checked on the chain it carries). */
  private async lobbyDeny(m: LobbyMessage, deny: Extract<LobbyBody, { t: "deny" }>): Promise<void> {
    const room = this.signed;
    if (!this.knocking || !room?.knock || deny.to !== room.key) return;
    // Its chain is taken once, as any is. The epoch it names only says when to look: until that's here (in pieces, in
    // any order) it waits (who said it and which epoch, nothing more: the latest one only).
    await room.knock.chain.add(deny.chain, () => this.verifies.take(m.sender, 1));
    this.pendingDeny = { by: m.key, tip: deny.tip };
    this.decideOnChain();
  }

  /**
   * Every decision that reads the chain (a no waiting, leaving as removed, knocking again, moving on): in the inbox,
   * after whatever's being received has validated its chain, rosters and wraps, never in the middle of it (a timer, a
   * re-key and a message all come here).
   */
  private decideOnChain(): void {
    // Asked for, then made at the next inbox boundary: the end of the frame being received (before the next frame
    // starts, so a removal's new keys are in place before anything queued after it), or a step of its own when asked
    // from outside the inbox (a timer, a re-key in a roster transaction).
    this.chainDecision = true;
    this.inbox = this.inbox.then(() => this.decideNow()).catch(() => this.reject("internal"));
  }

  /** The chain's decisions asked for so far, made now (in the inbox, between frames). */
  private async decideNow(): Promise<void> {
    while (this.chainDecision) {
      this.chainDecision = false;
      if (this.status === "left" || this.leaving || this.closing) return;
      this.checkDeny();
      await this.follow();
    }
  }

  /**
   * A no waiting at the door, looked at once its epoch's here: it counts only from someone who hosts or co-hosts now
   * (the newest epoch this page knows, never the one the no names: someone removed keeps no authority from an epoch
   * they once led), and only while this person isn't a member.
   */
  private checkDeny(): void {
    const room = this.signed;
    const chain = room?.knock?.chain;
    const pending = this.pendingDeny;
    if (!room || !chain || !pending || !this.knocking) return;
    // Its own epoch, and every chain a peer has said is on its way: the newest roster may be about to change.
    if ((pending.tip && !chain.byScope(pending.tip)) || this.catchingUp()) return;
    this.pendingDeny = undefined;
    const deepest = chain.deepest();
    if (!chain.leadsNow(pending.by) || !deepest || chain.rosterOf(deepest)!.state().members.has(room.key)) return;
    this.denied = true;
    this.emit();
    void this.leave();
  }

  private async lobbyHello(m: LobbyMessage, hello: Extract<LobbyBody, { t: "hello" }>): Promise<void> {
    const room = this.signed!;
    // At the door: a member's hello means someone's here and has been asked; knock to them (once a window or so).
    if (this.knocking) {
      if (hello.scope && !this.answeredBy.has(m.from)) {
        this.answeredBy.add(m.from);
        this.updateStatus();
        this.emit();
      }
      if (hello.scope && this.bundles.take(m.sender, 1)) this.sayHello(m.from);
      return;
    }
    const s = room.state();
    if (hello.proof && hello.scope === this.scope) {
      if (!s.members.has(m.key)) return this.reject("not-member");
      let proof: Uint8Array;
      try {
        proof = base64UrlToBytes(hello.proof);
      } catch {
        return this.reject("bad-proof");
      }
      if (!(await checkMemberProof(this.keys, m.senderBytes, proof))) return this.reject("bad-proof");
      const known = this.memberPeers.get(m.from) === m.sender;
      this.memberPeers.set(m.from, m.sender);
      this.provedKeys.set(m.from, m.key);
      if (this.knocks.delete(m.key)) this.emit();
      if (known) return;
      // A member, proved: what the room has, as on any peer appearing (and this one's own hello, if it lacks it).
      this.sayHello(m.from);
      this.sendPresence(m.from);
      this.sendRoster(m.from);
      this.requestSync(m.from);
      this.updateStatus();
      this.emit();
      return;
    }
    // A member behind on epochs (or without this one's secret): sent what it lacks, a few times a window at most.
    if (s.members.has(m.key)) {
      if (this.bundles.take(m.sender, 1)) this.sendBundle(m.from, [{ key: m.key, x: s.xs.get(m.key) ?? hello.x }]);
      return;
    }
    // Someone removed, back with an old epoch: the chain (no secret) tells their page it's out.
    if (hello.scope && this.removedOnPath().has(m.key)) {
      if (this.bundles.take(m.sender, 1)) this.sendBundle(m.from, []);
      return;
    }
    // A peer on an epoch this one doesn't know (ahead, or the other side of a partition): it hears this one is
    // behind, and sends what it has.
    if (hello.scope) {
      if (this.bundles.take(m.sender, 1)) this.sayHello(m.from);
      return;
    }
    this.knocked({ key: m.key, x: hello.x, alias: hello.alias || "Someone", peer: m.from, sender: m.sender, at: 0 });
  }

  /**
   * Someone at the door. The host and co-hosts are asked; with "ask" off, the host's page (else the earliest co-host's
   * here) lets them in, and someone who was in the room in an earlier epoch and wasn't removed (let in just as someone
   * else was removed) is let in by any host or co-host who knows it. Bounded: one knock per transport peer (another key from it replaces its last),
   * MAX_KNOCKS in all (the oldest goes), and a knock not said again for KNOCK_TTL_MS goes.
   */
  private knocked(k: Knock): void {
    const room = this.signed!;
    const s = room.state();
    if (!(s.host === room.key || s.cohosts.includes(room.key))) return;
    // Being let in already (an Admit waiting its turn): nothing more to ask.
    if (this.lettingIn.has(k.key)) return;
    // Told no, and still knocking (checking the chain, or trying again): told again (rate-limited), no card. Their
    // knocking keeps it remembered; a minute without it, and they're asked about again.
    const denied = this.denials.get(k.key);
    if (denied !== undefined && this.clock.now() - denied < KNOCK_TTL_MS) {
      this.denials.set(k.key, this.clock.now());
      if (this.bundles.take(k.sender, 1)) this.sendDeny(k.key, k.peer);
      return;
    }
    // Someone let in just as someone else was removed: back in at once, by whichever host or co-host knows it (the
    // host may not have seen that admission). With "ask" off, anyone, by one page: the host's, else a co-host's.
    if (this.wasMember(k.key)) {
      void this.admit(k.key, k);
      return;
    }
    if (!s.ask) {
      if (this.designatedLead()) void this.admit(k.key, k);
      return;
    }
    const known = this.knocks.get(k.key);
    const from = known?.peer;
    for (const [key, other] of this.knocks) if (other.peer === k.peer && key !== k.key) this.knocks.delete(key);
    // A knock said again keeps its place (the cards don't move under the host's pointer); only its time is new.
    if (known) Object.assign(known, { ...k, at: this.clock.now() });
    else this.knocks.set(k.key, { ...k, at: this.clock.now() });
    while (this.knocks.size > MAX_KNOCKS) {
      const oldest = [...this.knocks.values()].reduce((a, b) => (b.at < a.at ? b : a));
      this.knocks.delete(oldest.key);
    }
    if (!known || from !== k.peer) this.emit();
  }

  /** Knocks not said again for a while go (the newcomer left, or stopped waiting). */
  private expireKnocks(): void {
    const now = this.clock.now();
    let gone = false;
    for (const [key, k] of this.knocks)
      if (now - k.at > KNOCK_TTL_MS) {
        this.knocks.delete(key);
        gone = true;
      }
    if (gone) this.emit();
  }

  /** The epochs this session has been through, to its current one. */
  private path(): EpochStart[] {
    const room = this.signed;
    const current = room?.current;
    return current && room!.knock ? room!.knock.chain.path(current) : [];
  }

  /** The removals that closed each epoch on this session's path (each the next start's `prev`). */
  private closingRemovals(): RosterEntry[] {
    const chain = this.signed?.knock?.chain;
    const path = this.path();
    const out: RosterEntry[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const removal = chain?.rosterOf(path[i])?.named(path[i + 1].prev!);
      if (removal) out.push(removal);
    }
    return out;
  }

  /**
   * Who's out: each person a removal on this session's path took out, unless they've been let back in since (a member
   * of this epoch, by a join that counts in its roster: a host's or co-host's).
   */
  private removedOnPath(): Set<string> {
    const members = this.signed?.state().members;
    return new Set(
      this.closingRemovals()
        .map((r) => r.who!)
        .filter((k) => !members?.has(k)),
    );
  }

  /**
   * Whether `key` may be let back in without asking: let in during an earlier epoch on this session's path (just as
   * someone else was removed, so not carried into the next epoch), not removed since, and let in by someone who is the
   * host or a co-host now. An earlier epoch's roster is frozen at its close for anything it grants now: an entry there,
   * however late it arrives, counts only with authority its signer holds in this epoch, so someone removed (or no
   * longer a co-host) can't sign a backdated join into an epoch they once led and have it let anyone in.
   */
  private wasMember(key: string): boolean {
    const room = this.signed!;
    const chain = room.knock?.chain;
    if (!chain || this.removedOnPath().has(key)) return false;
    const s = room.state();
    const leads = new Set([s.host, ...s.cohosts]);
    return this.path()
      .slice(0, -1)
      .some((st) =>
        chain
          .rosterOf(st)
          ?.joinsOf(key)
          .some((j) => leads.has(j.by)),
      );
  }

  /** This person is the one to let people in on its own: the host if here, else the earliest co-host here. */
  private designatedLead(): boolean {
    const room = this.signed!;
    const s = room.state();
    const here = new Set([
      room.key,
      ...this.presence
        .list()
        .map((p) => room.identityOf(p.sender))
        .filter((k): k is string => !!k),
    ]);
    const lead = here.has(s.host) ? s.host : s.cohosts.find((c) => here.has(c));
    return lead === room.key;
  }

  /**
   * Admit: someone at the door is let in (a join entry, and, while new people may edit, an admit), then sent the
   * room's epochs and the secret, wrapped for them. Their key-agreement key is checked first (the wrap is made before
   * anything is signed): one that can't be agreed with is refused. False when this person may not, nobody by that key
   * knocked, or their key can't be used.
   */
  async admit(key: string, knock = this.knocks.get(key)): Promise<boolean> {
    const room = this.signed;
    if (!room?.knock || !knock || this.closing || this.lettingIn.has(key)) return false;
    // Answered now: the card goes at once (no Deny after it), and the knock isn't taken again while this waits its
    // turn. One roster transaction: the wrap is for the epoch the join lands in (a removal queued before it moves both).
    if (this.knocks.delete(key)) this.emit();
    this.denials.delete(key);
    this.lettingIn.add(key);
    return room
      .transact(() => this.admitNow(key, knock))
      .catch(() => false)
      .finally(() => this.lettingIn.delete(key));
  }

  private async admitNow(key: string, knock: Knock): Promise<boolean> {
    const room = this.signed!;
    const current = room.current;
    const secret = current && room.knock!.chain.secretOf(current);
    // Its turn: the decision still stands (nothing took it back), and this person may still let people in.
    if (!current || !secret || this.leaving || !this.lettingIn.has(key) || this.denials.has(key)) return false;
    const s = room.state();
    if (!(s.host === room.key || s.cohosts.includes(room.key))) return false;
    let wrap: Wrap;
    try {
      wrap = await wrapFor(
        this.keys.roomId,
        scopeOf(current),
        { identity: room.identity, agreement: room.knock!.agreement },
        { key, x: knock.x },
        secret,
      );
    } catch {
      this.reject("bad-agreement");
      return false;
    }
    if (!s.members.has(key) && !(await this.commitEntry("join", { who: key, x: knock.x }))) return false;
    if (!room.state().viewOnly && !room.state().editors.has(key)) await this.commitEntry("admit", { who: key });
    this.keepWrap(wrap);
    this.sendBundle(knock.peer, [{ key, x: knock.x }]);
    return true;
  }

  /** Deny: someone at the door is told no (with the chain, so they can check who said it). */
  deny(key: string): void {
    const knock = this.knocks.get(key);
    if (!this.signed?.knock || !knock || this.lettingIn.has(key)) return;
    this.knocks.delete(key);
    // Remembered a while: knocking again (still checking the chain, or trying again) is told no again, not asked.
    this.denials.delete(key);
    this.denials.set(key, this.clock.now());
    for (const old of this.denials.keys()) {
      if (this.denials.size <= MAX_KNOCKS * 4) break;
      this.denials.delete(old);
    }
    this.sendDeny(key, knock.peer);
    this.emit();
  }

  private sendDeny(key: string, peer: PeerId): void {
    const room = this.signed!;
    if (!room.knock) return;
    // With the chain, so the newcomer can check who said it: in the no itself, or (a long one) in pieces before it,
    // the no naming the epoch it's checked against (kept until that's arrived, in whatever order: lobbyDeny).
    const data = room.knock.chain.data(room.current);
    const pieces = chainMessages(data, []);
    void this.sendLobby(
      pieces.length === 1
        ? { t: "deny", to: key, chain: data }
        : [
            ...pieces.map((m) => ({ ...m, more: true as const })),
            { t: "deny", to: key, chain: { starts: [], logs: [] }, tip: room.scope },
          ],
      peer,
    );
  }

  /** A wrap this member keeps (checked: signed by a member of its epoch), at most one per epoch, recipient and wrapper. */
  private keepWrap(w: Wrap): void {
    this.wraps = [...this.wraps.filter((h) => !(h.scope === w.scope && h.to === w.to && h.from === w.from)), w].slice(
      -MAX_KEPT_WRAPS,
    );
  }

  /** The path to the current epoch, and its secret wrapped for `to` (a newcomer, a member behind), to one peer. */
  private sendBundle(peer: PeerId, to: { key: string; x: string }[]): void {
    const room = this.signed;
    const current = room?.current;
    const secret = current && room!.knock!.chain.secretOf(current);
    if (!room?.knock || !current || !secret) return;
    const scope = scopeOf(current);
    this.sendLobby(async () => {
      const wraps = this.wraps.filter((w) => w.scope === scope && to.some((t) => t.key === w.to));
      for (const t of to)
        if (!wraps.some((w) => w.to === t.key))
          try {
            wraps.push(
              await wrapFor(
                this.keys.roomId,
                scope,
                { identity: room.identity, agreement: room.knock!.agreement },
                t,
                secret,
              ),
            );
          } catch {
            this.reject("bad-agreement");
          }
      return chainMessages(room.knock!.chain.data(current), wraps);
    }, peer);
  }

  /**
   * A bundle: its epochs are checked and taken; each wrap counts only signed by whom it says wrapped it, a member of its
   * epoch: one for this person is opened and checked against its epoch's commitment at once (a bad one is dropped and
   * suppresses nothing), one for someone else is kept to pass on. Then this session follows the room forward, if it can.
   */
  private async lobbyBundle(m: LobbyMessage, bundle: Extract<LobbyBody, { t: "bundle" }>): Promise<void> {
    const room = this.signed;
    const chain = room?.knock?.chain;
    if (!room || !chain) return;
    await chain.add(bundle.chain, () => this.verifies.take(m.sender, 1));
    // Pieces of a long chain may come in any order: each is taken as it comes; a wrap for an epoch not here yet
    // waits (a few), and so does a no (lobbyDeny); both are looked at again with every piece.
    const wraps = [...this.pendingWraps, ...bundle.wraps];
    this.pendingWraps = [];
    for (const w of wraps) {
      const start = chain.byScope(w.scope);
      const roster = start && chain.rosterOf(start);
      if (!start || !roster) {
        if (w.to === room.key) this.pendingWraps = [...this.pendingWraps, w].slice(-MAX_KNOCKS);
        continue;
      }
      if (!(roster.state().members.has(w.from) || roster.base.members.has(w.from) || start.by === w.from)) continue;
      if (!this.verifies.take(m.sender, 1) || !(await wrapSigned(this.keys.roomId, w))) continue;
      if (w.to === room.key) {
        if (chain.secretOf(start)) continue;
        const secret = await unwrap(this.keys.roomId, w, { key: room.key, agreement: room.knock!.agreement });
        if (secret) await chain.learn(start, secret);
      } else this.keepWrap(w);
    }
    // The chain this piece is part of, as its sender said (only ever raised: ./chainCatchUp.ts).
    this.catchUp.note(m.sender, bundle.tip, this.clock.now());
    this.decideOnChain();
  }

  /** Whether a chain a peer has said it's sending is still to arrive (each checked against what's validated now). */
  private catchingUp(): boolean {
    const now = this.clock.now();
    this.catchUp.settle(this.signed?.knock?.chain.deepest()?.epoch ?? -1, now);
    return this.catchUp.pending(now);
  }

  /**
   * Where this session goes next, only ever forward along the line (only the host removes, so each epoch has one
   * successor): to the furthest start after its own (at the door: any) whose epoch this person is a member of and has
   * the secret for. A removal on the line ahead that names this person: they leave. Not a member ahead, and not
   * removed (let in just as someone was removed): they knock again.
   */
  private async follow(): Promise<void> {
    const room = this.signed;
    const chain = room?.knock?.chain;
    if (!room || !chain || this.leaving) return;
    const current = room.current;
    const ahead = chain
      .validated()
      .filter((st) => (current ? st.epoch > current.epoch && chain.path(st).includes(current) : true))
      .sort((a, b) => b.epoch - a.epoch || (a.sig < b.sig ? -1 : 1));
    for (const st of ahead) {
      if (!chain.rosterOf(st)!.state().members.has(room.key)) continue;
      const secret = chain.secretOf(st);
      if (secret) return this.rekey(st, secret);
    }
    if (this.knocking || !current || !ahead.length) return;
    // Nothing irreversible on part of a chain: not while a chain a peer said it's sending is still to arrive (looked at
    // again as it does, or when that wait runs out), nor while this person is a member at the end of the line (a
    // member there whose secret is on its way waits for it).
    if (this.catchingUp()) return;
    if (chain.rosterOf(ahead[0])!.state().members.has(room.key)) return;
    const line = chain.path(ahead[0]);
    const removed = line.some((p, i) => {
      const next = line[i + 1];
      return p.epoch >= current.epoch && !!next && chain.rosterOf(p)?.named(next.prev!)?.who === room.key;
    });
    if (removed) {
      this.removed = true;
      this.emit();
      void this.leave();
      return;
    }
    if (ahead.every((st) => !chain.rosterOf(st)!.state().members.has(room.key))) {
      this.knocking = true;
      this.answeredBy.clear();
      this.memberPeers.clear();
      this.provedKeys.clear();
      this.sayHello();
      this.updateStatus();
      this.emit();
    }
  }

  /**
   * Remove: the host (only the host) takes someone out of the room. A signed removal, then a new epoch: a new secret,
   * its start signed by the host, wrapped for everyone left (all prepared before anything changes: a member whose key
   * can't be agreed with is left out of the wraps), sent to everyone, and this session re-keyed. False when this
   * person may not, or it changes nothing.
   */
  /** The room has been through as many epochs as it can (each a removal): to remove anyone else, start a new room. */
  get atRemovalLimit(): boolean {
    const current = this.signed?.current;
    return !!current && current.epoch + 1 >= MAX_EPOCHS;
  }

  remove(key: string): Promise<boolean> {
    const room = this.signed;
    if (!room?.knock || this.closing) return Promise.resolve(false);
    // One roster transaction, from the draft to the re-key: nothing else this member signs lands in between.
    return room.transact(() => this.removeNow(key)).catch(() => false);
  }

  private async removeNow(key: string): Promise<boolean> {
    const room = this.signed!;
    const chain = room.knock!.chain;
    const current = room.current;
    if (!current || this.leaving || this.atRemovalLimit) return false;
    // Prepared in full before anything changes or is sent: the removal (signed, not kept), the next epoch's start,
    // its secret wrapped for everyone left, and every message that carries them, sealed.
    const removal = await room.draft("remove", { who: key });
    const next = removal && room.roster.nextAfter(removal);
    if (!removal || !next) return false;
    const secret = newEpochSecret();
    const epoch = current.epoch + 1;
    const start = await signStart(room.identity, this.keys.roomId, {
      epoch,
      kc: await commitEpoch(secret, this.keys.roomId, epoch),
      prev: removal.sig,
    });
    const scope = scopeOf(start);
    const mine = { identity: room.identity, agreement: room.knock!.agreement };
    const wraps: Wrap[] = [];
    for (const [key, x] of next.xs) {
      if (key === room.key) continue;
      try {
        wraps.push(await wrapFor(this.keys.roomId, scope, mine, { key, x }, secret));
      } catch {
        this.reject("bad-agreement");
      }
    }
    const data = chain.data(current);
    data.logs[data.logs.length - 1] = { scope: scopeOf(current), entries: [...room.roster.log(), removal] };
    data.starts.push(start);
    data.logs.push({ scope, entries: [] });
    let frames: Uint8Array[];
    try {
      frames = (await Promise.all(chainMessages(data, wraps).map((m) => this.lobby!.seal(m)))).flat();
    } catch {
      this.reject("too-large");
      return false;
    }
    // Everything's ready. Checked again (the epoch, and the roster the removal was drafted on: a peer's entry may
    // have closed the epoch meanwhile), then, only now, does anything change.
    if (room.current !== current || room.state().removal) return false;
    await room.roster.add([removal]);
    if (!room.roster.has(removal.sig) || room.current !== current) return false;
    await chain.addStarts([start]);
    if (!chain.rosterOf(start) || !(await chain.learn(start, secret))) return false;
    for (const w of wraps) this.keepWrap(w);
    // Everyone hears of it (the one removed too: their page sees it's out, and can't read what follows), then this
    // session moves.
    const sent = this.outbox.then(() => this.sendFrames(frames));
    this.outbox = sent;
    await sent;
    await this.rekey(start, secret);
    return true;
  }

  /**
   * This session moves to a new epoch, in place: the same document, sender id and Live; new keys from here on. Only
   * forward, and never to an epoch it has sealed under before: no (key, sender, counter) is ever used twice.
   */
  private async rekey(start: EpochStart, secret: Uint8Array): Promise<void> {
    const room = this.signed!;
    const scope = scopeOf(start);
    const from = room.current;
    if (this.sealedScopes.has(scope) || (from && start.epoch <= from.epoch)) return;
    const keys = await deriveEpochKeys(this.lobbyKeys!, start.epoch, secret);
    const members = room.knock!.chain.rosterOf(start)?.state().members;
    const job = this.outbox.then(async () => {
      if (this.leaving || this.status === "left" || this.sealedScopes.has(scope)) return;
      if (room.current && start.epoch <= room.current.epoch) return;
      this.sealedScopes.add(scope);
      const sender = this.sealer.sender;
      // Presence: who stays starts its ordering over (their counters restart under the new keys); who's out goes.
      this.presence.restart((p) => !!members?.has(room.keyOf(p) ?? ""));
      this.keys = keys;
      this.scope = scope;
      this.knocking = false;
      this.sealer = new Sealer(keys, sender);
      this.sealer.sign = room.signFrame;
      this.opener = new Opener(keys, sender);
      room.rekey(keys, start);
      this.memberPeers.clear();
      this.provedKeys.clear();
      this.committedSinceRekey = false;
      for (const q of this.held.values()) q.stop();
      this.held.clear();
      this.reassembler.clear();
      this.synced.clear();
      this.asked.clear();
      this.framesSinceBye = 0;
      // The local copy, under the new epoch's storage key from here (the old one's last save first). At the door
      // there was none: the room's copy on this device (another tab's) is read now the secret is known.
      const old = this.recovery;
      if (this.recoveryStore) {
        this.recovery = new RoomRecovery(this.recoveryStore, keys, () => this.emit(), Date.now, this.clock, scope);
        if (!old) await this.recovery.restore(this.doc);
        this.recovery.watch(this.doc);
        // The old copy's last save runs on its own: the new epoch doesn't wait for storage to say who's here.
        void old?.close(this.doc).catch(() => {});
      }
      await this.bind();
    });
    this.outbox = job.catch(() => this.reject("internal"));
    await this.outbox;
    if (this.scope !== scope) return;
    this.authRevision++;
    this.prepareBye();
    this.sayHello();
    this.updateStatus();
    this.emit();
    // The chain may already go further (a later epoch known meanwhile), or leave this person out of it.
    this.decideOnChain();
  }

  /** The current epoch, its secret, and the wraps this member holds: what a reload needs to come back. */
  memberRecord(): { chain: ChainData; scope: string; secret: string; wraps: Wrap[] } | undefined {
    const room = this.signed;
    const current = room?.current;
    const secret = current && room!.knock!.chain.secretOf(current);
    if (!room?.knock || !current || !secret || this.knocking) return undefined;
    return {
      chain: room.knock.chain.data(current),
      scope: scopeOf(current),
      secret: bytesToBase64Url(secret),
      wraps: this.wraps.filter((w) => w.scope === scopeOf(current)),
    };
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
      .then(async () => {
        await this.receive(from, bytes);
        // What this frame asked of the chain (a removal's new epoch, a no), before the next frame is looked at.
        await this.decideNow();
      })
      .catch(() => this.reject("internal"))
      .finally(done);
    return this.inbox;
  }

  private async receive(from: PeerId, bytes: Uint8Array): Promise<void> {
    if (this.status === "left" || this.leaving || this.closing) return;
    this.stats.framesReceived++;
    // The lobby is opened apart (its own key); a room without knock-to-join has none.
    if (frameChannel(bytes) === "lobby")
      return this.lobby ? this.receiveLobby(from, bytes) : this.reject("bad-channel");
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
      // Knock-to-join: only members' presence counts (someone holding a leaked secret isn't one).
      if (!room.isMember(state.key)) return this.reject("not-member");
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
      // A sender bound just now: if anything of theirs was dropped unchecked, it's asked for again at once (what's
      // only held is applied as the binding drains it; a healthy join asks nothing more).
      if (bound === "bound" && this.behind.has(sender)) {
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
      if (!room.isMember(key)) return this.reject("not-member");
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
        if (msg.payload.length !== 32 || !this.hasDocument || !this.roomPeers().includes(from)) return;
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
        // It has what this one lacks: asked for, unless this one's request to it is still to be answered.
        if (this.doc.lacksFrom(sv) && !this.awaiting(from)) this.requestSync(from);
        return;
      }
      case DOC.syncReply:
      case DOC.update: {
        if (msg.type === DOC.syncReply) this.asked.delete(from);
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
        for (let i = 0; i < (added?.refused ?? 0); i++) this.reject("roster-refused");
        for (let i = 0; i < (added?.throttled ?? 0); i++) this.reject("verify-throttled");
        // A removal that may now be the epoch's first, or a new current epoch: followed.
        if (room.knock) this.decideOnChain();
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
