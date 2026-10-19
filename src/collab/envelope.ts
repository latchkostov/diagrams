import { senderKey, type Channel, type RoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import { ReplayWindow } from "./replay";

// The authenticated envelope every room frame travels in, whatever the transport. AES-256-GCM (WebCrypto) under the
// sender's subkey (./keys.ts); the header is authenticated as additional data, together with the room id.
//
//   offset  bytes  field
//   0       2      magic "LD"
//   2       1      version (1)
//   3       1      channel (1 document, 2 presence, 3 shared Live)
//   4       4      key epoch, u32 big-endian
//   8       16     sender id: random per session
//   24      8      counter, u64 big-endian, from 1, strictly increasing per sender and channel
//   32      n+16   ciphertext and GCM tag
//
//   IV  = 4 zero bytes || counter (8 bytes): unique, since each sender's subkey is its own and its counter only grows.
//   AAD = header (32 bytes) || room id (32 bytes).
//
// In a signed room (P4) the plaintext ends with the sender's Ed25519 signature over the header and the message
// (`sign`, inside the encryption): ./session.ts checks it against the key the sender's presence binds it to.
//
// Opening checks, in order, before any decryption: length bounds for the channel, magic, version, channel, epoch
// (another epoch's frame is refused, old or new), not our own sender id, the sender cap, and the replay window.
// Then GCM authenticates; only then is the counter recorded. Any failure is a typed rejection, never an exception
// a hostile peer could use to break the receive loop.

export const HEADER_BYTES = 32;
const TAG_BYTES = 16;
const VERSION = 1;
const CHANNEL_CODE: Record<Channel, number> = { doc: 1, presence: 2, live: 3 };
const CODE_CHANNEL: Record<number, Channel | undefined> = { 1: "doc", 2: "presence", 3: "live" };
export const SENDER_ID_BYTES = 16;
/** What a signed room's frames carry after their message: an Ed25519 signature (./signing.ts). */
export const FRAME_SIGNATURE_BYTES = 64;

export type Rejection =
  | "too-short"
  | "too-large"
  | "bad-magic"
  | "bad-version"
  | "bad-channel"
  | "old-epoch"
  | "future-epoch"
  | "reflected"
  | "too-many-senders"
  | "replay"
  | "stale"
  | "bad-counter"
  | "auth-failed";

export type Opened =
  | {
      ok: true;
      channel: Channel;
      sender: string;
      senderBytes: Uint8Array;
      counter: number;
      plaintext: Uint8Array;
      /** The frame's 32-byte header (what a signed room's signature covers with the message). */
      header: Uint8Array;
    }
  | { ok: false; reason: Rejection };

const maxFrame = (channel: Channel) =>
  channel === "doc"
    ? COLLAB_LIMITS.maxDocFrameBytes
    : channel === "live"
      ? COLLAB_LIMITS.maxLiveFrameBytes
      : COLLAB_LIMITS.maxPresenceFrameBytes;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function header(channel: Channel, epoch: number, sender: Uint8Array, counter: number): Uint8Array {
  const h = new Uint8Array(HEADER_BYTES);
  const v = new DataView(h.buffer);
  h[0] = 0x4c; // L
  h[1] = 0x44; // D
  h[2] = VERSION;
  h[3] = CHANNEL_CODE[channel];
  v.setUint32(4, epoch);
  h.set(sender, 8);
  v.setBigUint64(24, BigInt(counter));
  return h;
}

function iv(counter: number): Uint8Array {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigUint64(4, BigInt(counter));
  return out;
}

function aad(head: Uint8Array, roomId: Uint8Array): Uint8Array {
  const out = new Uint8Array(head.length + roomId.length);
  out.set(head, 0);
  out.set(roomId, head.length);
  return out;
}

/**
 * Subkeys per sender. A key is kept only once a frame under it authenticated (`keep`), so frames under made-up
 * sender ids can't grow the cache; authenticated senders are bounded by the sender cap.
 */
class KeyCache {
  private keys = new Map<string, Promise<CryptoKey>>();
  constructor(private readonly room: RoomKeys) {}
  get(channel: Channel, sender: Uint8Array, id: string): Promise<CryptoKey> {
    return this.keys.get(`${channel}:${id}`) ?? senderKey(this.room, channel, sender);
  }
  keep(channel: Channel, id: string, key: Promise<CryptoKey>): void {
    this.keys.set(`${channel}:${id}`, key);
  }
}

/** Seals frames for one session: its own sender id and counters. */
export class Sealer {
  private counters: Record<Channel, number> = { doc: 0, presence: 0, live: 0 };
  private keys: KeyCache;
  readonly senderHex: string;

  /**
   * A signed room's signer (P4): the signature over a frame's header and message, appended to the message before
   * it's encrypted. Absent: frames carry no signature (a room without roles).
   */
  sign?: (head: Uint8Array, message: Uint8Array) => Promise<Uint8Array>;

  constructor(
    private readonly room: RoomKeys,
    readonly sender: Uint8Array,
  ) {
    if (sender.length !== SENDER_ID_BYTES) throw new Error("A sender id is 16 bytes.");
    this.keys = new KeyCache(room);
    this.senderHex = hex(sender);
  }

  async seal(channel: Channel, message: Uint8Array): Promise<Uint8Array> {
    const extra = this.sign ? FRAME_SIGNATURE_BYTES : 0;
    if (message.length + extra + HEADER_BYTES + TAG_BYTES > maxFrame(channel))
      throw new Error(`That ${channel} frame is too large to send.`);
    const counter = ++this.counters[channel];
    if (counter >= COLLAB_LIMITS.maxCounter) throw new Error("This session has sent too many frames; rejoin the room.");
    const head = header(channel, this.room.epoch, this.sender, counter);
    let plaintext = message;
    if (this.sign) {
      const signature = await this.sign(head, message);
      if (signature.length !== FRAME_SIGNATURE_BYTES) throw new Error("A frame signature is 64 bytes.");
      plaintext = new Uint8Array(message.length + FRAME_SIGNATURE_BYTES);
      plaintext.set(message, 0);
      plaintext.set(signature, message.length);
    }
    const pending = this.keys.get(channel, this.sender, this.senderHex);
    this.keys.keep(channel, this.senderHex, pending);
    const key = await pending;
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv(counter) as BufferSource,
          additionalData: aad(head, this.room.roomIdBytes) as BufferSource,
        },
        key,
        plaintext as BufferSource,
      ),
    );
    const out = new Uint8Array(HEADER_BYTES + ct.length);
    out.set(head, 0);
    out.set(ct, HEADER_BYTES);
    return out;
  }
}

/** Opens frames from other sessions, keeping one replay window per sender and channel. */
export class Opener {
  private windows = new Map<string, ReplayWindow>();
  /** A deferred frame's subkey, until it's accepted (dropped with the frame otherwise). */
  private readonly deferredKeys = new WeakMap<object, Promise<CryptoKey>>();
  private senders = new Set<string>();
  private keys: KeyCache;

  constructor(
    private readonly room: RoomKeys,
    /** Our own sender id: a frame claiming it is a reflection (or a forgery) and is refused. */
    private readonly self: Uint8Array,
  ) {
    this.keys = new KeyCache(room);
  }

  /**
   * Opens a frame. `deferred` (a signed room): its counter isn't recorded yet, nor its sender counted; `accept`
   * does that once its signature verifies, so a frame forged under someone's sender id (anyone with the room key can
   * seal one) can't use up their counters.
   */
  async open(frame: Uint8Array, deferred = false): Promise<Opened> {
    if (frame.length < HEADER_BYTES + TAG_BYTES) return { ok: false, reason: "too-short" };
    if (frame.length > COLLAB_LIMITS.maxDocFrameBytes) return { ok: false, reason: "too-large" };
    if (frame[0] !== 0x4c || frame[1] !== 0x44) return { ok: false, reason: "bad-magic" };
    if (frame[2] !== VERSION) return { ok: false, reason: "bad-version" };
    const channel = CODE_CHANNEL[frame[3]];
    if (!channel) return { ok: false, reason: "bad-channel" };
    if (frame.length > maxFrame(channel)) return { ok: false, reason: "too-large" };
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const epoch = view.getUint32(4);
    if (epoch < this.room.epoch) return { ok: false, reason: "old-epoch" };
    if (epoch > this.room.epoch) return { ok: false, reason: "future-epoch" };
    const senderBytes = frame.slice(8, 24);
    const sender = hex(senderBytes);
    if (sender === hex(this.self)) return { ok: false, reason: "reflected" };
    const big = view.getBigUint64(24);
    if (big < 1n || big >= BigInt(COLLAB_LIMITS.maxCounter)) return { ok: false, reason: "bad-counter" };
    const counter = Number(big);
    if (!this.senders.has(sender) && this.senders.size >= COLLAB_LIMITS.maxSenders)
      return { ok: false, reason: "too-many-senders" };
    const windowKey = `${channel}:${sender}`;
    const window = this.windows.get(windowKey);
    const verdict = window ? window.check(counter) : "ok";
    if (verdict === "replay" || verdict === "stale") return { ok: false, reason: verdict };
    if (verdict === "invalid") return { ok: false, reason: "bad-counter" };
    const head = frame.subarray(0, HEADER_BYTES);
    let plaintext: Uint8Array;
    const pending = this.keys.get(channel, senderBytes, sender);
    try {
      const key = await pending;
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: iv(counter) as BufferSource,
            additionalData: aad(head, this.room.roomIdBytes) as BufferSource,
          },
          key,
          frame.subarray(HEADER_BYTES) as BufferSource,
        ),
      );
    } catch {
      return { ok: false, reason: "auth-failed" };
    }
    const opened = { ok: true as const, channel, sender, senderBytes, counter, plaintext, header: head.slice() };
    // A deferred frame's subkey isn't kept until it's accepted: frames under invented sender ids keep nothing.
    if (deferred) {
      this.deferredKeys.set(opened, pending);
      return opened;
    }
    const accepted = this.accept(opened, pending);
    return accepted === true ? opened : { ok: false, reason: accepted };
  }

  /**
   * Records an opened frame's counter (and counts its sender): true, or why it can't be (a copy of it was accepted
   * meanwhile, the sender cap). The window is looked up again: another frame from this sender may have been opened
   * while this one was decrypting.
   */
  accept(
    opened: { channel: Channel; sender: string; counter: number },
    key: Promise<CryptoKey> | undefined = this.deferredKeys.get(opened),
  ): true | Rejection {
    const { channel, sender, counter } = opened;
    if (!this.senders.has(sender) && this.senders.size >= COLLAB_LIMITS.maxSenders) return "too-many-senders";
    const windowKey = `${channel}:${sender}`;
    let w = this.windows.get(windowKey);
    if (!w) {
      w = new ReplayWindow(COLLAB_LIMITS.replayWindow);
      this.windows.set(windowKey, w);
    }
    const again = w.check(counter);
    if (again !== "ok") return again === "replay" ? "replay" : again === "stale" ? "stale" : "bad-counter";
    this.senders.add(sender);
    if (key) this.keys.keep(channel, sender, key);
    w.accept(counter);
    return true;
  }

  /** Senders whose frames have authenticated (bounded by COLLAB_LIMITS.maxSenders). */
  get senderCount(): number {
    return this.senders.size;
  }
}
