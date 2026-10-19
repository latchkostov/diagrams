import { bytesToBase64Url, textToBytes } from "../interop/codec";
import { ROOM_SECRET_BYTES, type RoomLink } from "./link";
import { secureRandom, type RandomBytes } from "./random";

// The room's key schedule. WebCrypto only, no primitive of our own: HKDF-SHA-256 expands the room secret (from the
// link) into independent, domain-separated values, one per purpose and epoch:
//
//   info "livediagrams/collab/v1/<purpose>/epoch=<n>", salt "livediagrams/collab/v1"
//
//   room-id      32 bytes, public: the room's name on any transport. Reveals nothing about the secret (HKDF is a
//                PRF), and two rooms' ids are unrelated, so ids can't be linked across rooms or epochs.
//   discovery    20 bytes, public: the BitTorrent tracker info_hash for the matchmaking spike. Separate from the
//                room id so a tracker's hash can't be matched against any other transport's room name.
//   doc          AES-256-GCM base for document frames.
//   presence     AES-256-GCM base for presence frames (alias, colour, status).
//   live         AES-256-GCM base for shared Live frames (the driver's run: its start, ops, clock and digests).
//   signal       AES-256-GCM key that encrypts WebRTC offers/answers on public matchmaking. Independent of the
//                content keys, so a signalling adapter never holds a key that opens the diagram.
//   storage      AES-256-GCM key for local encrypted CRDT checkpoints, never used on the wire.
//
// Document and presence frames are sealed with per-sender subkeys: HKDF(<channel base>, info "sender/<id>"). Each
// session draws a fresh random 16-byte sender id, so every (subkey, counter) pair, and therefore every GCM IV, is
// used once, across reloads and concurrent tabs alike, without coordinating counters between them.
//
// Every derived key is non-extractable. The secret itself is only ever held by the page (from the fragment).

const SALT = textToBytes("livediagrams/collab/v1");
const info = (purpose: string, epoch: number) => textToBytes(`livediagrams/collab/v1/${purpose}/epoch=${epoch}`);

export type Channel = "doc" | "presence" | "live";

export interface RoomKeys {
  epoch: number;
  /** Public room id, base64url (43 characters). */
  roomId: string;
  roomIdBytes: Uint8Array;
  /** Public 20-byte discovery hash for BitTorrent trackers (spike only). */
  discovery: Uint8Array;
  /** Signalling key: encrypts SDP on public matchmaking. */
  signal: CryptoKey;
  /** Local recovery only; independent of every wire key and scoped to this generation. */
  storage: CryptoKey;
  /** Per-channel HKDF bases for sender subkeys. */
  channels: Record<Channel, CryptoKey>;
}

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("This browser can't encrypt a room (WebCrypto is missing).");
  return globalThis.crypto.subtle;
};

const freshRooms = new WeakSet<RoomLink>();

/** Reserve creation across async initialization; only a successful activation consumes it. */
export function reserveRoomCreation(room: RoomLink): { commit(): void; rollback(): void } | undefined {
  if (!freshRooms.delete(room)) return undefined;
  let reserved = true;
  return {
    commit() {
      reserved = false;
    },
    rollback() {
      if (reserved) freshRooms.add(room);
      reserved = false;
    },
  };
}

/** A new room: 32 random bytes from WebCrypto, epoch 0; a signed room (v2) when it has its creator's key. */
export function newRoom(random: RandomBytes = secureRandom, hostKey?: string): RoomLink {
  const room: RoomLink = { epoch: 0, secret: random(ROOM_SECRET_BYTES), ...(hostKey ? { hostKey } : {}) };
  freshRooms.add(room);
  return room;
}

async function bits(base: CryptoKey, purpose: string, epoch: number, length: number): Promise<Uint8Array> {
  const out = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: info(purpose, epoch) },
    base,
    length * 8,
  );
  return new Uint8Array(out);
}

async function hkdfBase(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", raw as BufferSource, "HKDF", false, ["deriveBits", "deriveKey"]);
}

export async function deriveRoomKeys(room: RoomLink): Promise<RoomKeys> {
  if (room.secret.length !== ROOM_SECRET_BYTES) throw new Error("A room secret is 32 bytes.");
  const base = await hkdfBase(room.secret);
  const [roomIdBytes, discovery, signalRaw, docRaw, presenceRaw, storageRaw, liveRaw] = await Promise.all([
    bits(base, "room-id", room.epoch, 32),
    bits(base, "discovery", room.epoch, 20),
    bits(base, "signal", room.epoch, 32),
    bits(base, "doc", room.epoch, 32),
    bits(base, "presence", room.epoch, 32),
    bits(base, "storage", room.epoch, 32),
    bits(base, "live", room.epoch, 32),
  ]);
  const [signal, doc, presence, storage, live] = await Promise.all([
    subtle().importKey("raw", signalRaw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]),
    hkdfBase(docRaw),
    hkdfBase(presenceRaw),
    subtle().importKey("raw", storageRaw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]),
    hkdfBase(liveRaw),
  ]);
  // The raw intermediate bytes are dropped here; only non-extractable keys survive.
  signalRaw.fill(0);
  docRaw.fill(0);
  presenceRaw.fill(0);
  storageRaw.fill(0);
  liveRaw.fill(0);
  return {
    epoch: room.epoch,
    roomId: bytesToBase64Url(roomIdBytes),
    roomIdBytes,
    discovery,
    signal,
    storage,
    channels: { doc, presence, live },
  };
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The AES-256-GCM subkey for one sender on one channel. */
export async function senderKey(keys: RoomKeys, channel: Channel, sender: Uint8Array): Promise<CryptoKey> {
  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: SALT,
      info: textToBytes(`livediagrams/collab/v1/${channel}/sender/${hex(sender)}`),
    },
    keys.channels[channel],
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
