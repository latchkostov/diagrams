import type { Clock } from "./clock";
import { COLLAB_LIMITS } from "./limits";

// What a room's decrypted frames say: one type byte, then its payload. Document channel:
//
//   1 sync-request   <Yjs state vector>   "this is what I have": the receiver replies with what it lacks
//   2 sync-reply     <Yjs update>         the difference, to the requester only
//   3 update         <Yjs update>         one local step, to everyone
//   4 bye                                 leaving (presence goes at once rather than on expiry)
//   5 fragment       <header> <part>      one part of a larger message (below)
//   6 sync-proof     <SHA-256>             canonical state-vector and delete-set proof
//   7 sync-ack       <SHA-256>             confirms the peer has that same state (not remote durability)
//   8 roster         <JSON>                a signed room's roster (P4, ./roster.ts): {"e": [entries]}, or a summary
//                                          {"h": <hash>} a peer whose roster differs answers with its entries
//
// Presence channel:
//
//   1 state          <JSON {alias, colour, status}>
//
// Shared Live channel (src/collab/room/liveShare.ts):
//
//   1 message        <JSON>  the driver's start, ops, beacons, digests and log slices; a follower's request
//
// Peers never forward each other's updates (no loops); anti-entropy (a periodic sync-request) heals drops and
// partitions instead, since a CRDT state vector names exactly what is missing.

export const DOC = {
  syncRequest: 1,
  syncReply: 2,
  update: 3,
  bye: 4,
  fragment: 5,
  syncProof: 6,
  syncAck: 7,
  roster: 8,
} as const;
export const PRESENCE = { state: 1 } as const;
export const LIVE = { message: 1 } as const;

export function frame(type: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + (payload?.length ?? 0));
  out[0] = type;
  if (payload) out.set(payload, 1);
  return out;
}

export function unframe(bytes: Uint8Array): { type: number; payload: Uint8Array } | undefined {
  if (!bytes.length) return undefined;
  return { type: bytes[0], payload: bytes.subarray(1) };
}

/** An empty Yjs update (no structs, no deletions): nothing to send. */
export const isEmptyUpdate = (u: Uint8Array) => u.length <= 2 && u.every((b) => b === 0);

// Fragments: a document message longer than maxFragmentBytes (a big sync reply, a large paste) is sent as parts of
// exactly maxFragmentBytes (the last shorter), each in its own frame, so frames stay small and a room's size isn't
// bounded by a frame. Header: message id (u32), part index (u16), part count (u16), whole length (u32). Every field
// is checked against the others and the limits before anything is kept; half-delivered messages are bounded per
// sender and expire on the room clock. Each part has its own envelope counter, so the replay window covers parts.

const FRAGMENT_HEADER = 12;

/** `message` (a whole document plaintext: type byte and payload) as fragment frames. */
export function fragment(message: Uint8Array, id: number): Uint8Array[] {
  const size = COLLAB_LIMITS.maxFragmentBytes;
  const count = Math.ceil(message.length / size);
  return Array.from({ length: count }, (_, i) => {
    const part = message.subarray(i * size, Math.min(message.length, (i + 1) * size));
    const out = new Uint8Array(1 + FRAGMENT_HEADER + part.length);
    const view = new DataView(out.buffer);
    out[0] = DOC.fragment;
    view.setUint32(1, id >>> 0);
    view.setUint16(5, i);
    view.setUint16(7, count);
    view.setUint32(9, message.length);
    out.set(part, 1 + FRAGMENT_HEADER);
    return out;
  });
}

export type Reassembled =
  { done: Uint8Array } | { pending: true } | { error: "malformed" | "too-large" | "too-many-partials" };

/** What a Reassembler holds at most: a message's length, and half-delivered messages per sender and in all. */
export interface ReassemblyLimits {
  maxMessageBytes: number;
  maxPartialMessages: number;
  maxPartialBytesPerSender: number;
  maxPartialBytes: number;
}

/** Puts fragments back together, per sender, within the limits. */
export class Reassembler {
  private partial = new Map<
    string,
    { sender: string; length: number; count: number; parts: (Uint8Array | undefined)[]; got: number; at: number }
  >();

  constructor(
    private readonly clock: Clock,
    /** The document's limits by default; the lobby has small ones of its own. */
    private readonly limits: ReassemblyLimits = COLLAB_LIMITS,
    /**
     * Whether a sender's half-delivered messages may make way for another's (the lobby: people at the door make way
     * for members, so they can never block one).
     */
    private readonly yields: (sender: string) => boolean = () => false,
  ) {}

  /** Bytes reserved for half-delivered messages (each message's whole length, from its first part). */
  private reserved = 0;

  /** Drops half-delivered messages older than the TTL (the session calls this on the room clock, too). */
  expire(): void {
    const now = this.clock.now();
    for (const [k, p] of this.partial) if (now - p.at > COLLAB_LIMITS.partialTtlMs) this.drop(k);
  }

  /** Whether a half-delivered message from `sender` is held. */
  holds(sender: string): boolean {
    for (const p of this.partial.values()) if (p.sender === sender) return true;
    return false;
  }

  /** Bytes reserved for half-delivered messages. */
  get held(): number {
    return this.reserved;
  }

  /** Forgets everything (leaving). */
  clear(): void {
    this.partial.clear();
    this.reserved = 0;
  }

  private drop(key: string): void {
    const p = this.partial.get(key);
    if (!p) return;
    this.partial.delete(key);
    this.reserved -= p.length;
  }

  add(sender: string, payload: Uint8Array): Reassembled {
    const now = this.clock.now();
    this.expire();
    if (payload.length < FRAGMENT_HEADER) return { error: "malformed" };
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const id = view.getUint32(0);
    const index = view.getUint16(4);
    const count = view.getUint16(6);
    const length = view.getUint32(8);
    const size = COLLAB_LIMITS.maxFragmentBytes;
    const limits = this.limits;
    // A declared length past the limit is refused before anything is reserved for it.
    if (length > limits.maxMessageBytes) return { error: "too-large" };
    // A message that fits one frame is never fragmented; the count and every part's length follow from the length.
    if (length <= size || count !== Math.ceil(length / size) || index >= count) return { error: "malformed" };
    const body = payload.subarray(FRAGMENT_HEADER);
    if (body.length !== (index < count - 1 ? size : length - (count - 1) * size)) return { error: "malformed" };
    const key = `${sender}:${id}`;
    let entry = this.partial.get(key);
    if (!entry) {
      // The whole message's length is reserved from its first part, against the sender's and the session's budgets,
      // before any part is kept.
      let open = 0;
      let held = 0;
      for (const p of this.partial.values())
        if (p.sender === sender) {
          open++;
          held += p.length;
        }
      if (open >= limits.maxPartialMessages || held + length > limits.maxPartialBytesPerSender)
        return { error: "too-many-partials" };
      // Full: a sender that doesn't yield takes the place of the oldest that do.
      if (this.reserved + length > limits.maxPartialBytes && !this.yields(sender))
        for (const [k, p] of this.partial) {
          if (this.reserved + length <= limits.maxPartialBytes) break;
          if (this.yields(p.sender)) this.drop(k);
        }
      if (this.reserved + length > limits.maxPartialBytes) return { error: "too-many-partials" };
      entry = { sender, length, count, parts: new Array<Uint8Array | undefined>(count), got: 0, at: now };
      this.partial.set(key, entry);
      this.reserved += length;
    }
    if (entry.length !== length || entry.count !== count || entry.parts[index]) {
      this.drop(key);
      return { error: "malformed" };
    }
    entry.parts[index] = body.slice();
    entry.got++;
    if (entry.got < count) return { pending: true };
    this.drop(key);
    const out = new Uint8Array(length);
    let at = 0;
    for (const part of entry.parts) {
      out.set(part!, at);
      at += part!.length;
    }
    return { done: out };
  }

  /** Half-delivered messages held now, and the bytes reserved for them. */
  get pending(): number {
    return this.partial.size;
  }

  get pendingBytes(): number {
    return this.reserved;
  }
}
