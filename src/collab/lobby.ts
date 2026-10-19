import { base64UrlToBytes, bytesToBase64Url, bytesToText, textToBytes } from "../interop/codec";
import type { Clock } from "./clock";
import { frameChannel, Opener, Sealer } from "./envelope";
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
// messages do. Lobby frames are rate-limited per sender, and each signature check is counted against its budget.

export const LOBBY = { message: 1, fragment: 5 } as const;
/** A lobby message's JSON at most (a bundle carries the rosters of a room's epochs). */
export const MAX_LOBBY_MESSAGE_BYTES = 4 * 1024 * 1024;
/** Lobby frames a sender may deliver per window, and messages it may have verified. */
const LOBBY_FRAMES_PER_WINDOW = 256;
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

function chainData(v: unknown): ChainData | undefined {
  if (!isRecord(v) || !Array.isArray(v.starts) || !Array.isArray(v.logs) || v.starts.length > 64 || v.logs.length > 64)
    return undefined;
  if (
    !v.logs.every((l) => isRecord(l) && typeof l.scope === "string" && l.scope.length < 120 && Array.isArray(l.entries))
  )
    return undefined;
  return { starts: v.starts, logs: v.logs as ChainData["logs"] };
}

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
      const chain = chainData(v.chain);
      if (!chain || !Array.isArray(v.wraps) || v.wraps.length > MAX_WRAPS) return undefined;
      const wraps = v.wraps.filter(
        (w): w is Wrap =>
          isRecord(w) &&
          typeof w.scope === "string" &&
          w.scope.length < 120 &&
          key(w.to) &&
          key(w.from) &&
          typeof w.fx === "string" &&
          B64_43.test(w.fx) &&
          typeof w.w === "string" &&
          /^[A-Za-z0-9_-]{80}$/.test(w.w) &&
          typeof w.sig === "string" &&
          /^[A-Za-z0-9_-]{86}$/.test(w.sig),
      );
      if (wraps.length !== v.wraps.length) return undefined;
      return {
        t: "bundle",
        chain,
        wraps: wraps.map((w) => ({ scope: w.scope, to: w.to, from: w.from, fx: w.fx, w: w.w, sig: w.sig })),
      };
    }
    case "deny": {
      const chain = chainData(v.chain);
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

/** A token bucket per sender on the room clock. */
class Bucket {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly clock: Clock,
    private readonly cap: number,
  ) {}
  take(sender: string): boolean {
    const now = this.clock.now();
    const b = this.buckets.get(sender) ?? { tokens: this.cap, at: now };
    b.tokens = Math.min(this.cap, b.tokens + ((now - b.at) / COLLAB_LIMITS.senderWindowMs) * this.cap);
    b.at = now;
    this.buckets.set(sender, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/** One end of a room's lobby: seals and signs this session's messages, opens and checks others'. */
export class Lobby {
  private readonly sealer: Sealer;
  private readonly opener: Opener;
  private readonly reassembler: Reassembler;
  private readonly rate: Bucket;
  private nextMessage = 0;
  /** The key a sender's half-received message is signed by (all its fragments must be). */
  private readonly partKeys = new Map<string, string>();
  /** Why the last frame was refused (for counting). */
  refused?: string;

  constructor(
    readonly keys: RoomKeys,
    readonly identity: Identity,
    readonly sender: Uint8Array,
    clock: Clock,
  ) {
    if (keys.epoch !== 0) throw new Error("The lobby's keys are epoch 0's.");
    this.sealer = new Sealer(keys, sender);
    this.sealer.sign = (head, message) => sign(identity.privateKey, frameBytes(keys.roomId, head, message));
    this.opener = new Opener(keys, sender);
    this.reassembler = new Reassembler(clock);
    this.rate = new Bucket(clock, LOBBY_FRAMES_PER_WINDOW);
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
    const opened = await this.opener.open(bytes, true);
    if (!opened.ok) return this.refuse(opened.reason);
    if (!this.rate.take(opened.sender)) return this.refuse("lobby-throttled");
    const plain = opened.plaintext;
    if (plain.length < 1 + KEY_BYTES + SIG_BYTES) return this.refuse("malformed");
    const signed = plain.subarray(0, plain.length - SIG_BYTES);
    const signature = plain.subarray(plain.length - SIG_BYTES);
    const key = bytesToBase64Url(signed.subarray(signed.length - KEY_BYTES));
    if (!publicKeyBytes(key)) return this.refuse("malformed");
    if (!(await verify(key, signature, frameBytes(this.keys.roomId, opened.header, signed))))
      return this.refuse("bad-signature");
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
