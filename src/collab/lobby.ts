import { base64UrlToBytes, bytesToBase64Url, bytesToText, textToBytes } from "../interop/codec";
import type { Clock } from "./clock";
import { parseChainData, parseWraps } from "./chainShape";
import { frameChannel, frameSender, Opener, Sealer } from "./envelope";
import type { ChainData } from "./epochs";
import type { RoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import { fragment, frame, Reassembler, unframe } from "./protocol";
import {
  publicKeyBytes,
  sign,
  signedBytes,
  unwrapSecret,
  verify,
  wrapSecret,
  type Agreement,
  type Identity,
} from "./signing";
import type { PeerId } from "./transport/types";

// The lobby of a knock-to-join room (meeting hosts design §2, P5): what the link alone reaches. Its frames are sealed
// under the link's lobby key (./keys.ts), epoch 0 always, so the lobby is the same in every epoch. Every frame (each
// fragment too) carries its sender's identity key and that key's signature over the room id, the frame's header
// (channel, epoch, sender id, counter) and the message, inside the encryption: a frame counts, and its counter is
// recorded, only once that verifies, so nobody can replay someone's message under another counter or poison their
// replay window. A message's fragments are all signed by one key.
//
//   hello    who this is (their key, their key-agreement key, a name) and, from a member, the epoch it's in and its
//            proof that it holds that epoch's secret (an HMAC of its sender id). Members send each other content only
//            once a hello's proof checks: someone who knocks never gets a frame of the room's content. A hello
//            without a proof for the current epoch is a knock (or a member who's behind: it's sent what it lacks).
//   bundle   the room's epochs (starts and rosters) and secrets wrapped for whom it's for: an admission (to the
//            newcomer), a re-key (to everyone left), or what a member behind on epochs lacks.
//   deny     the host or a co-host says no to a knock (with the chain, so the newcomer can check who said it).
//
// Messages are JSON, bounded, checked in full; a message larger than a frame travels in fragments, as document
// messages do.
//
// Anyone with the link reaches the lobby, so what it keeps is bounded before anything is decrypted or verified:
// - a budget per transport peer, taken before a frame is decrypted or its signature checked (a peer sending frames
//   under endless invented sender ids, or with bad signatures, costs at most its budget, and leaves nothing behind);
// - a few sender ids per transport peer (a session has one), each bound to the one key that signs its frames;
// - two pools of senders: members' (the room's members and its host, as many as any room keeps), and everyone else's
//   (people at the door: a smaller pool, its least recently heard going first), so people knocking, or someone
//   pretending to, can never take the places members need;
// - a transport peer gone frees its senders' places (their replay windows stay a while: the same session back counts
//   on from where it was, and its old frames stay refused);
// - a budget per sender once its frame verifies (buckets for verified senders only, and bounded: idle ones go).

export const LOBBY = { message: 1, fragment: 5 } as const;
/** A lobby message's JSON at most (a bundle carries the rosters of a room's epochs). */
export const MAX_LOBBY_MESSAGE_BYTES = 4 * 1024 * 1024;
/**
 * Half-delivered lobby messages held at most: one message's length (a bundle), two in progress per sender, and a few
 * in all (people at the door make way for members: ./protocol.ts).
 */
const LOBBY_REASSEMBLY = {
  maxMessageBytes: MAX_LOBBY_MESSAGE_BYTES + 1,
  maxPartialMessages: 2,
  maxPartialBytesPerSender: 2 * (MAX_LOBBY_MESSAGE_BYTES + 1),
  maxPartialBytes: 4 * (MAX_LOBBY_MESSAGE_BYTES + 1),
};
/** Lobby frames a sender may deliver per window, and messages it may have verified. */
const LOBBY_FRAMES_PER_WINDOW = 256;
/** Sender ids one transport peer may speak under (one session's; a second for slack). */
export const MAX_LOBBY_SENDERS_PER_PEER = 2;
/** Lobby frames one transport peer may have decrypted and checked per window: its senders' worth. */
const LOBBY_FRAMES_PER_PEER = LOBBY_FRAMES_PER_WINDOW * MAX_LOBBY_SENDERS_PER_PEER;
/** Senders who aren't members (people at the door) kept at once: the least recently heard goes first. */
export const MAX_LOBBY_GUESTS = 32;
/** Senders gone (their peer gone, or a guest's place taken) whose replay windows are kept: the most recent. */
const MAX_RETIRED = 1024;
const B64_43 = /^[A-Za-z0-9_-]{43}$/;
const MAX_ALIAS = 60;
const MAX_WRAPS = 64;

export interface Wrap {
  /** The epoch it's a secret of (its scope). */
  scope: string;
  /** Whom it's for, and who wrapped it (their key-agreement key, to unwrap with). */
  to: string;
  from: string;
  fx: string;
  w: string;
  /** The wrapper's signature over all of the above: a wrap is checked before it's kept or passed on. */
  sig: string;
}

const wrapBytes = (roomId: string, w: Omit<Wrap, "sig">) =>
  signedBytes("livediagrams/wrap/v1", roomId, w.scope, w.to, w.from, w.fx, w.w);

/** Whether a wrap is signed by whom it says wrapped it. */
export async function wrapSigned(roomId: string, wrap: Wrap): Promise<boolean> {
  try {
    return await verify(wrap.from, base64UrlToBytes(wrap.sig), wrapBytes(roomId, wrap));
  } catch {
    return false;
  }
}

export type LobbyBody =
  | { t: "hello"; x: string; alias: string; scope?: string; proof?: string }
  | { t: "bundle"; chain: ChainData; wraps: Wrap[] }
  | { t: "deny"; to: string; chain: ChainData };

export interface LobbyMessage {
  /** The sender's identity key (the message is signed by it). */
  key: string;
  body: LobbyBody;
  sender: string;
  senderBytes: Uint8Array;
  from: PeerId;
}

/** What a wrap covers: the room, the epoch, and both ends. */
export const wrapInfo = (roomId: string, scope: string, to: string, from: string) =>
  signedBytes("livediagrams/wrap-info/v1", roomId, scope, to, from);

export async function wrapFor(
  roomId: string,
  scope: string,
  mine: { identity: Identity; agreement: Agreement },
  to: { key: string; x: string },
  secret: Uint8Array,
): Promise<Wrap> {
  const info = wrapInfo(roomId, scope, to.key, mine.identity.key);
  const body = {
    scope,
    to: to.key,
    from: mine.identity.key,
    fx: mine.agreement.x,
    w: await wrapSecret(mine.agreement, to.x, info, secret),
  };
  return { ...body, sig: bytesToBase64Url(await sign(mine.identity.privateKey, wrapBytes(roomId, body))) };
}

export async function unwrap(roomId: string, wrap: Wrap, mine: { key: string; agreement: Agreement }) {
  if (wrap.to !== mine.key) return undefined;
  return unwrapSecret(mine.agreement, wrap.fx, wrapInfo(roomId, wrap.scope, wrap.to, wrap.from), wrap.w);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const key = (v: unknown): v is string => typeof v === "string" && !!publicKeyBytes(v);

/** A lobby message's body, checked in full, or undefined. */
export function parseBody(v: unknown): LobbyBody | undefined {
  if (!isRecord(v) || typeof v.t !== "string") return undefined;
  switch (v.t) {
    case "hello": {
      if (typeof v.x !== "string" || !B64_43.test(v.x) || typeof v.alias !== "string") return undefined;
      if (Object.keys(v).some((k) => !["t", "x", "alias", "scope", "proof"].includes(k))) return undefined;
      const member = v.scope !== undefined || v.proof !== undefined;
      if (
        member &&
        (typeof v.scope !== "string" || v.scope.length > 120 || typeof v.proof !== "string" || !B64_43.test(v.proof))
      )
        return undefined;
      return {
        t: "hello",
        x: v.x,
        alias: v.alias.slice(0, MAX_ALIAS),
        ...(member ? { scope: v.scope as string, proof: v.proof as string } : {}),
      };
    }
    case "bundle": {
      const chain = parseChainData(v.chain);
      const wraps = parseWraps(v.wraps, MAX_WRAPS);
      return chain && wraps ? { t: "bundle", chain, wraps } : undefined;
    }
    case "deny": {
      const chain = parseChainData(v.chain);
      return key(v.to) && chain ? { t: "deny", to: v.to, chain } : undefined;
    }
    default:
      return undefined;
  }
}

const frameBytes = (roomId: string, head: Uint8Array, message: Uint8Array) =>
  signedBytes("livediagrams/lobby-frame/v1", roomId, head, message);
const KEY_BYTES = 32;
const SIG_BYTES = 64;

/**
 * Token buckets on the room clock, one per key, bounded: a bucket idle a whole window is full again (the same as none),
 * so idle ones go once there are too many, then the least recently used.
 */
export class Buckets {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly clock: Clock,
    private readonly cap: number,
    private readonly max = 256,
  ) {}
  take(key: string, n = 1): boolean {
    const now = this.clock.now();
    const b = this.buckets.get(key) ?? { tokens: this.cap, at: now };
    b.tokens = Math.min(this.cap, b.tokens + ((now - b.at) / COLLAB_LIMITS.senderWindowMs) * this.cap);
    b.at = now;
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.max) this.sweep(now);
    if (b.tokens < n) return false;
    b.tokens -= n;
    return true;
  }
  forget(key: string): void {
    this.buckets.delete(key);
  }
  get size(): number {
    return this.buckets.size;
  }
  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (now - b.at >= COLLAB_LIMITS.senderWindowMs) this.buckets.delete(k);
    for (const k of this.buckets.keys()) {
      if (this.buckets.size <= this.max) break;
      this.buckets.delete(k);
    }
  }
}

interface Slot {
  peer: PeerId;
  /** The key its frames are signed by. */
  key: string;
  member: boolean;
  at: number;
}

/** One end of a room's lobby: seals and signs this session's messages, opens and checks others'. */
export class Lobby {
  private readonly sealer: Sealer;
  private readonly opener: Opener;
  private readonly reassembler: Reassembler;
  private readonly rate: Buckets;
  private readonly peerRate: Buckets;
  /** Senders whose frames have verified: their transport peer, key and pool. */
  private readonly slots = new Map<string, Slot>();
  /** Senders gone whose replay windows are still kept, oldest first. */
  private readonly retired = new Set<string>();
  private nextMessage = 0;
  /** The key a sender's half-received message is signed by (all its fragments must be). */
  private readonly partKeys = new Map<string, string>();
  /** Why the last frame was refused (for counting). */
  refused?: string;
  /** Whether a key is the room's (a member, or its host): its sender takes a member's place, not a guest's. */
  isMember: (key: string) => boolean = () => false;

  constructor(
    readonly keys: RoomKeys,
    readonly identity: Identity,
    readonly sender: Uint8Array,
    private readonly clock: Clock,
  ) {
    if (keys.epoch !== 0) throw new Error("The lobby's keys are epoch 0's.");
    this.sealer = new Sealer(keys, sender);
    this.sealer.sign = (head, message) => sign(identity.privateKey, frameBytes(keys.roomId, head, message));
    this.opener = new Opener(keys, sender, COLLAB_LIMITS.maxSenders + MAX_LOBBY_GUESTS);
    this.reassembler = new Reassembler(clock, LOBBY_REASSEMBLY, (sender) => !this.slots.get(sender)?.member);
    this.rate = new Buckets(clock, LOBBY_FRAMES_PER_WINDOW, COLLAB_LIMITS.maxSenders + MAX_LOBBY_GUESTS);
    this.peerRate = new Buckets(clock, LOBBY_FRAMES_PER_PEER);
  }

  /** What the lobby keeps now: senders by pool, sender buckets, transport peers' buckets (diagnostics, tests). */
  load(): { members: number; guests: number; buckets: number; peers: number; retired: number } {
    let members = 0;
    for (const slot of this.slots.values()) if (slot.member) members++;
    return {
      members,
      guests: this.slots.size - members,
      buckets: this.rate.size,
      peers: this.peerRate.size,
      retired: this.retired.size,
    };
  }

  /** A transport peer gone: its senders' places are freed. */
  forget(peer: PeerId): void {
    for (const [sender, slot] of this.slots) if (slot.peer === peer) this.release(sender);
    this.peerRate.forget(peer);
  }

  /** A sender's place freed; its replay windows kept, for the most recent MAX_RETIRED senders gone. */
  private release(sender: string): void {
    this.slots.delete(sender);
    this.opener.forget(sender);
    this.rate.forget(sender);
    this.partKeys.delete(sender);
    this.retired.delete(sender);
    this.retired.add(sender);
    for (const old of this.retired) {
      if (this.retired.size <= MAX_RETIRED) break;
      this.retired.delete(old);
      if (!this.slots.has(old)) this.opener.forget(old, true);
    }
  }

  private sendersOf(peer: PeerId): number {
    let n = 0;
    for (const slot of this.slots.values()) if (slot.peer === peer) n++;
    return n;
  }

  /**
   * A verified sender's place: kept (its peer and key the same as before), or a new one in its pool. A guest's pool
   * full: its least recently heard goes. False: no place (the members' pool full, its peer at its senders, or a key
   * that isn't the one its frames have been signed by).
   */
  private place(sender: string, peer: PeerId, key: string): boolean {
    const now = this.clock.now();
    const slot = this.slots.get(sender);
    if (slot) {
      if (slot.peer !== peer || slot.key !== key) return false;
      slot.at = now;
      if (!slot.member && this.isMember(key) && this.load().members < COLLAB_LIMITS.maxSenders) slot.member = true;
      return true;
    }
    if (this.sendersOf(peer) >= MAX_LOBBY_SENDERS_PER_PEER) return false;
    const member = this.isMember(key);
    const { members, guests } = this.load();
    if (member && members >= COLLAB_LIMITS.maxSenders) return false;
    if (!member && guests >= MAX_LOBBY_GUESTS) {
      let oldest: [string, Slot] | undefined;
      for (const entry of this.slots) if (!entry[1].member && (!oldest || entry[1].at < oldest[1].at)) oldest = entry;
      if (oldest) this.release(oldest[0]);
    }
    this.retired.delete(sender);
    this.slots.set(sender, { peer, key, member, at: now });
    return true;
  }

  /** A body, signed and sealed: one frame, or fragments. */
  async seal(body: LobbyBody): Promise<Uint8Array[]> {
    const json = textToBytes(JSON.stringify(body));
    if (json.length > MAX_LOBBY_MESSAGE_BYTES) throw new Error("That lobby message is too large.");
    const message = frame(LOBBY.message, json);
    const parts = message.length <= COLLAB_LIMITS.maxFragmentBytes ? [message] : fragment(message, ++this.nextMessage);
    const key = base64UrlToBytes(this.identity.key);
    const out: Uint8Array[] = [];
    for (const part of parts) {
      // Each frame: its part, the signer's key, then (the sealer adds it) the signature over header and both.
      const plain = new Uint8Array(part.length + KEY_BYTES);
      plain.set(part);
      plain.set(key, part.length);
      out.push(await this.sealer.seal("lobby", plain));
    }
    return out;
  }

  /**
   * A lobby frame from `from`: its message, once whole and checked; undefined otherwise (`refused` says why). Its
   * counter is recorded only once its signature verifies.
   */
  async open(from: PeerId, bytes: Uint8Array): Promise<LobbyMessage | undefined> {
    this.refused = undefined;
    if (frameChannel(bytes) !== "lobby") return this.refuse("bad-channel");
    // Before anything is decrypted or verified: the peer's budget, and its sender ids.
    if (!this.peerRate.take(from)) return this.refuse("lobby-throttled");
    const id = frameSender(bytes);
    if (id !== undefined) {
      const slot = this.slots.get(id);
      if (slot ? slot.peer !== from : this.sendersOf(from) >= MAX_LOBBY_SENDERS_PER_PEER)
        return this.refuse("too-many-senders");
    }
    const opened = await this.opener.open(bytes, true);
    if (!opened.ok) return this.refuse(opened.reason);
    const plain = opened.plaintext;
    if (plain.length < 1 + KEY_BYTES + SIG_BYTES) return this.refuse("malformed");
    const signed = plain.subarray(0, plain.length - SIG_BYTES);
    const signature = plain.subarray(plain.length - SIG_BYTES);
    const key = bytesToBase64Url(signed.subarray(signed.length - KEY_BYTES));
    if (!publicKeyBytes(key)) return this.refuse("malformed");
    if (!(await verify(key, signature, frameBytes(this.keys.roomId, opened.header, signed))))
      return this.refuse("bad-signature");
    // Verified: only now does its sender keep anything here (a place, a bucket, a replay window).
    if (!this.place(opened.sender, from, key)) return this.refuse("too-many-senders");
    if (!this.rate.take(opened.sender)) return this.refuse("lobby-throttled");
    const accepted = this.opener.accept(opened);
    if (accepted !== true) return this.refuse(accepted);
    let msg = unframe(signed.subarray(0, signed.length - KEY_BYTES));
    if (!msg) return this.refuse("malformed");
    if (msg.type === LOBBY.fragment) {
      // One message's fragments, one signer.
      const held = this.partKeys.get(opened.sender);
      if (held && held !== key) {
        this.partKeys.delete(opened.sender);
        return this.refuse("malformed");
      }
      this.partKeys.set(opened.sender, key);
      const part = this.reassembler.add(opened.sender, msg.payload);
      if ("error" in part) {
        this.partKeys.delete(opened.sender);
        return this.refuse(part.error);
      }
      if ("pending" in part) return undefined;
      this.partKeys.delete(opened.sender);
      msg = unframe(part.done);
    }
    if (!msg || msg.type !== LOBBY.message || msg.payload.length > MAX_LOBBY_MESSAGE_BYTES)
      return this.refuse("malformed");
    let body: LobbyBody | undefined;
    try {
      body = parseBody(JSON.parse(bytesToText(msg.payload)));
    } catch {
      body = undefined;
    }
    if (!body) return this.refuse("malformed");
    return { key, body, sender: opened.sender, senderBytes: opened.senderBytes, from };
  }

  private refuse(reason: string): undefined {
    this.refused = reason;
    return undefined;
  }

  clear(): void {
    this.reassembler.clear();
    this.partKeys.clear();
  }
}
