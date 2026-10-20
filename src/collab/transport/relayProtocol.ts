import { COLLAB_LIMITS } from "../limits";

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
} as const;

export type RelayHello = { t: "hello"; v: 1; room: string };
export type RelayControl =
  | { t: "welcome"; self: string; peers: string[]; cap: number; maxFrame: number; durable: false }
  | { t: "join" | "leave"; peer: string };

export const isRoomId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
export const isPeerId = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{16}$/.test(s);

export function parseHello(text: string): RelayHello | undefined {
  try {
    const h = JSON.parse(text);
    if (h?.t === "hello" && h.v === 1 && isRoomId(h.room) && Object.keys(h).length === 3) return h;
  } catch {
    /* Invalid control message. */
  }
}

export function parseControl(text: string): RelayControl | undefined {
  try {
    const m = JSON.parse(text);
    if ((m?.t === "join" || m?.t === "leave") && isPeerId(m.peer)) return m;
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
      m.durable === false
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
