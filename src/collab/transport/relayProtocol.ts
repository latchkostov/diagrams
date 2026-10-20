import { COLLAB_LIMITS } from "../limits";
import { signedBytes } from "../signing";

// DOM-free wire contract, shared with the relay. Content is always an opaque encrypted envelope.
export const RELAY_SUBPROTOCOL = "livediagrams.relay.v1";
export const RELAY_LIMITS = {
  roomCap: 8,
  maxFrameBytes: COLLAB_LIMITS.maxDocFrameBytes + 64,
  maxPayload: COLLAB_LIMITS.maxDocFrameBytes + 1024,
  // Carry the full session frame contract plus the largest (addressed) relay header.
  minPayload: COLLAB_LIMITS.maxDocFrameBytes + 9,
  closeFrameBytes: 127, // Maximum control frame, including an echoed peer close reason.
  bytesPerWindow: COLLAB_LIMITS.senderBytesPerWindow,
  windowMs: COLLAB_LIMITS.senderWindowMs,
  framesPerSecond: 200,
  frameBurst: 1000,
  socketBufferBytes: 128 * 1024 * 1024,
  totalBufferBytes: 512 * 1024 * 1024,
  maxRooms: 1000,
  maxSockets: 4000,
  socketsPerIp: 64,
  helloTimeoutMs: 10_000,
  pingIntervalMs: 25_000,
  missedPongs: 2,
  idleTimeoutMs: 5 * 60_000,
} as const;
export const RELAY_CLOSE = {
  badFrame: 4000,
  origin: 4003,
  full: 4008,
  serverFull: 4013,
  rate: 4029,
  restart: 1012,
  tooBig: 1009,
  /** A knock-to-join room's member removed (the chain the relay holds says so): closed at once (shared Live P6). */
  removed: 4010,
} as const;

/**
 * `root`: a knock-to-join room's root (its host key, from the link). The relay then admits only members: a socket
 * proves the member key it speaks for (a signature over the relay's challenge), the room's signed chain is pushed to
 * it in plaintext (it checks signatures, never content), and it forwards to and from a socket that isn't a member only
 * the lobby (channel 4); a member removed is closed at once (shared Live P6).
 */
export type RelayHello = { t: "hello"; v: 1; room: string; root?: string };
export type RelayControl =
  | {
      t: "welcome";
      self: string;
      peers: string[];
      cap: number;
      maxFrame: number;
      durable: false;
      /** A knock-to-join room's: what this socket signs to say which member it is. */
      challenge?: string;
    }
  | { t: "join" | "leave"; peer: string }
  /** Whether this socket is admitted (a member of the newest epoch the relay holds). */
  | { t: "status"; member: boolean };
/** What a knock-to-join room's socket says to the relay: the member key it speaks for, and the room's chain. */
export type RelayClientControl =
  | { t: "prove"; key: string; sig: string }
  | { t: "chain"; chain: { starts: unknown[]; logs: { scope: string; entries: unknown[] }[] } };

const KEY = /^[A-Za-z0-9_-]{43}$/;
const SIG = /^[A-Za-z0-9_-]{86}$/;
/** The lobby's channel code in an envelope's header (byte 3): all a socket that isn't a member sends or gets. */
export const LOBBY_CHANNEL = 4;

/** What a socket's proof signs: the room, the relay's challenge to it, its relay peer id, and the key. */
export const relayProofBytes = (room: string, challenge: string, peer: string, key: string) =>
  signedBytes("livediagrams/relay-admit/v1", room, challenge, peer, key);

export function parseClientControl(text: string): RelayClientControl | undefined {
  try {
    const m = JSON.parse(text);
    if (m?.t === "prove" && KEY.test(m.key) && SIG.test(m.sig) && Object.keys(m).length === 3)
      return { t: "prove", key: m.key, sig: m.sig };
    if (m?.t === "chain" && Object.keys(m).length === 2 && m.chain && typeof m.chain === "object") return m;
  } catch {
    /* Invalid control message. */
  }
}

export const isRoomId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
export const isPeerId = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{16}$/.test(s);

export function parseHello(text: string): RelayHello | undefined {
  try {
    const h = JSON.parse(text);
    if (h?.t !== "hello" || h.v !== 1 || !isRoomId(h.room)) return;
    if (Object.keys(h).length === 3) return h;
    if (Object.keys(h).length === 4 && typeof h.root === "string" && KEY.test(h.root)) return h;
  } catch {
    /* Invalid control message. */
  }
}

export function parseControl(text: string): RelayControl | undefined {
  try {
    const m = JSON.parse(text);
    if ((m?.t === "join" || m?.t === "leave") && isPeerId(m.peer)) return m;
    if (m?.t === "status" && typeof m.member === "boolean" && Object.keys(m).length === 2) return m;
    if (
      m?.t === "welcome" &&
      isPeerId(m.self) &&
      Array.isArray(m.peers) &&
      m.peers.every(isPeerId) &&
      new Set(m.peers).size === m.peers.length &&
      !m.peers.includes(m.self) &&
      Number.isInteger(m.cap) &&
      m.cap > 0 &&
      m.cap <= COLLAB_LIMITS.maxSenders &&
      m.peers.length < m.cap &&
      Number.isInteger(m.maxFrame) &&
      m.maxFrame > 0 &&
      m.maxFrame <= RELAY_LIMITS.maxFrameBytes &&
      m.durable === false &&
      (m.challenge === undefined || (typeof m.challenge === "string" && KEY.test(m.challenge)))
    )
      return m;
  } catch {
    /* Invalid control message. */
  }
}

export function peerBytes(peer: string): Uint8Array {
  if (!isPeerId(peer)) throw new Error("Invalid relay peer ID");
  return Uint8Array.from({ length: 8 }, (_, i) => parseInt(peer.slice(i * 2, i * 2 + 2), 16));
}
export const peerHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function clientFrame(envelope: Uint8Array, to?: string): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array((to === undefined ? 1 : 9) + envelope.length);
  if (to !== undefined) {
    frame[0] = 1;
    frame.set(peerBytes(to), 1);
  }
  frame.set(envelope, to === undefined ? 1 : 9);
  return frame;
}
export function readClientFrame(frame: Uint8Array): { to?: string; envelope: Uint8Array } | undefined {
  if (frame[0] === 0 && frame.length > 1) return { envelope: frame.subarray(1) };
  if (frame[0] === 1 && frame.length > 9) return { to: peerHex(frame.subarray(1, 9)), envelope: frame.subarray(9) };
}
export function serverFrame(envelope: Uint8Array, from: string): Uint8Array {
  const frame = new Uint8Array(9 + envelope.length);
  frame.set(peerBytes(from), 1);
  frame.set(envelope, 9);
  return frame;
}
export function readServerFrame(frame: Uint8Array): { from: string; envelope: Uint8Array } | undefined {
  if (frame[0] === 0 && frame.length > 9)
    return { from: peerHex(frame.subarray(1, 9)), envelope: Uint8Array.from(frame.subarray(9)) };
}
