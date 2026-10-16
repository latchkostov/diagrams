import { base64UrlToBytes, bytesToBase64Url, bytesToText, textToBytes } from "../../interop/codec";
import { realClock, type Clock } from "../clock";
import { COLLAB_LIMITS } from "../limits";
import { secureRandom, type RandomBytes } from "../random";
import { FrameTooLargeError, type CollabTransport, type PeerId, type TransportHandlers } from "./types";

// C0 SPIKE, Lab only: WebRTC data channels matched through public BitTorrent WebSocket trackers (the WebTorrent
// tracker protocol, as Trystero's torrent strategy uses it), written here rather than taken as a dependency so every
// byte a tracker sees is ours to check. Never used by default, never in tests or CI against real trackers: the Lab
// starts it only on an explicit click, with tracker and STUN URLs it shows first.
//
// What a tracker sees (docs/research/collaboration-threat-model.md, "Public matchmaking"):
//   - the connecting IP and timing (unavoidable);
//   - info_hash: the room's 20-byte discovery hash (HKDF of the room secret; unrelated to any other room or epoch);
//   - peer_id and offer_id: 20 random bytes per session / per offer;
//   - offers and answers as "ld1.<base64url>": AES-256-GCM under the room's signalling key (its own HKDF output,
//     never a key that opens the diagram), so no SDP, ICE candidate, IP inside SDP or fingerprint is readable;
//   - message counts and sizes.
// Peers connected directly see each other's IPs (WebRTC needs them). STUN sees the caller's address.
//
// One connection per pair: an offer is accepted only by the peer whose id is greater (the other side ignores it and
// re-announces sooner, so its own offer reaches the greater one). Frames larger than a data channel message are
// split into 16 KiB chunks and reassembled with bounds (size, count, concurrent partial frames per peer).

export interface TrackerOptions {
  /** wss:// tracker URLs, chosen by the person. */
  trackers: readonly string[];
  /** The room's discovery hash (RoomKeys.discovery): 20 bytes. */
  discovery: Uint8Array;
  /** The room's signalling key (RoomKeys.signal). */
  signal: CryptoKey;
  iceServers?: RTCIceServer[];
  maxPeers?: number;
  /** Offers per announce. */
  offers?: number;
  /** Seconds between announces when the tracker doesn't say. */
  announceSeconds?: number;
  random?: RandomBytes;
  clock?: Clock;
  /** Injected for the synthetic capture test; the browser's otherwise. */
  WebSocket?: new (url: string) => WebSocket;
  RTCPeerConnection?: new (config: RTCConfiguration) => RTCPeerConnection;
  /** Diagnostics for the Lab: never secrets, SDP or payloads. */
  onEvent?: (event: string) => void;
}

const CHUNK = 16 * 1024;
const CHUNK_HEADER = 8;
const MAX_PARTIAL_PER_PEER = 4;
const OFFER_TTL_MS = 30_000;
const GATHER_TIMEOUT_MS = 5_000;
const SIGNAL_PREFIX = "ld1.";

const latin1 = (b: Uint8Array) => String.fromCharCode(...b);
const fromLatin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const hex = (s: string) => Array.from(fromLatin1(s), (x) => x.toString(16).padStart(2, "0")).join("");

/** Encrypts an SDP for the tracker, bound to the room, the direction and the offer id. */
export async function sealSignal(
  key: CryptoKey,
  discovery: Uint8Array,
  kind: "offer" | "answer",
  offerId: string,
  sdp: string,
  random: RandomBytes,
): Promise<string> {
  const iv = random(12);
  const aad = textToBytes(`livediagrams/collab/v1/signal/${kind}/${bytesToBase64Url(discovery)}/${hex(offerId)}`);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
      key,
      textToBytes(sdp) as BufferSource,
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return SIGNAL_PREFIX + bytesToBase64Url(out);
}

export async function openSignal(
  key: CryptoKey,
  discovery: Uint8Array,
  kind: "offer" | "answer",
  offerId: string,
  sealed: unknown,
): Promise<string | undefined> {
  if (typeof sealed !== "string" || !sealed.startsWith(SIGNAL_PREFIX) || sealed.length > 64 * 1024) return undefined;
  try {
    const bytes = base64UrlToBytes(sealed.slice(SIGNAL_PREFIX.length));
    if (bytes.length < 12 + 16) return undefined;
    const aad = textToBytes(`livediagrams/collab/v1/signal/${kind}/${bytesToBase64Url(discovery)}/${hex(offerId)}`);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) as BufferSource, additionalData: aad as BufferSource },
      key,
      bytes.subarray(12) as BufferSource,
    );
    return bytesToText(new Uint8Array(pt));
  } catch {
    return undefined;
  }
}

interface Peer {
  id: PeerId;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  open: boolean;
  nextMsg: number;
  partial: Map<number, { parts: (Uint8Array | undefined)[]; got: number; bytes: number }>;
}

export interface TrackerTransport extends CollabTransport {
  /** Sockets open now, peers connected now. */
  diagnostics(): { trackersOpen: number; peers: number; pendingOffers: number };
}

export function createTrackerTransport(opts: TrackerOptions): TrackerTransport {
  const random = opts.random ?? secureRandom;
  const clock = opts.clock ?? realClock;
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  const PC = opts.RTCPeerConnection ?? globalThis.RTCPeerConnection;
  const maxPeers = opts.maxPeers ?? 8;
  const offersPerAnnounce = opts.offers ?? 3;
  const infoHash = latin1(opts.discovery);
  const selfId = latin1(random(20));
  const self = hex(selfId);
  const event = (e: string) => opts.onEvent?.(e);
  const maxFrameBytes = COLLAB_LIMITS.maxDocFrameBytes + 64;

  let handlers: TransportHandlers | undefined;
  let closed = false;
  const sockets: WebSocket[] = [];
  const peers = new Map<PeerId, Peer>();
  /** Our outstanding offers by offer id: the connection waiting for an answer. */
  const pending = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel; at: number }>();
  let cancelTimer: (() => void) | undefined;
  let lastQuickAnnounce = -Infinity;

  const config = (): RTCConfiguration => ({ iceServers: opts.iceServers ?? [] });

  function gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", check);
        cancel();
        resolve();
      };
      const check = () => pc.iceGatheringState === "complete" && done();
      const cancel = clock.after(GATHER_TIMEOUT_MS, done);
      pc.addEventListener("icegatheringstatechange", check);
    });
  }

  function send(ws: WebSocket, msg: Record<string, unknown>) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function attach(peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (closed || peer.open) return;
      peer.open = true;
      event("peer connected");
      handlers?.join(peer.id);
    };
    channel.onclose = () => drop(peer.id);
    channel.onmessage = (e: MessageEvent) => receive(peer, e.data);
  }

  function drop(id: PeerId) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    try {
      peer.channel?.close();
      peer.pc.close();
    } catch {
      /* already closed */
    }
    if (peer.open) {
      event("peer left");
      handlers?.leave(id);
    }
  }

  function receive(peer: Peer, data: unknown) {
    if (
      closed ||
      !(data instanceof ArrayBuffer) ||
      data.byteLength < CHUNK_HEADER ||
      data.byteLength > CHUNK + CHUNK_HEADER
    )
      return drop(peer.id);
    const view = new DataView(data);
    const msg = view.getUint32(0);
    const index = view.getUint16(4);
    const total = view.getUint16(6);
    const maxChunks = Math.ceil(maxFrameBytes / CHUNK);
    if (total < 1 || total > maxChunks || index >= total) return drop(peer.id);
    const body = new Uint8Array(data, CHUNK_HEADER);
    let p = peer.partial.get(msg);
    if (!p) {
      if (peer.partial.size >= MAX_PARTIAL_PER_PEER) return drop(peer.id);
      p = { parts: new Array(total), got: 0, bytes: 0 };
      peer.partial.set(msg, p);
    }
    if (p.parts.length !== total || p.parts[index]) return drop(peer.id);
    p.parts[index] = body.slice();
    p.got++;
    p.bytes += body.length;
    if (p.bytes > maxFrameBytes) return drop(peer.id);
    if (p.got < total) return;
    peer.partial.delete(msg);
    const frame = new Uint8Array(p.bytes);
    let at = 0;
    for (const part of p.parts) {
      frame.set(part!, at);
      at += part!.length;
    }
    void handlers?.frame(peer.id, frame);
  }

  async function makeOffer(): Promise<{ offer_id: string; offer: { type: "offer"; sdp: string } } | undefined> {
    const pc = new PC(config());
    const channel = pc.createDataChannel("ld", { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const offerId = latin1(random(20));
    const sdp = pc.localDescription?.sdp;
    if (!sdp || closed) {
      pc.close();
      return undefined;
    }
    pending.set(offerId, { pc, channel, at: clock.now() });
    return {
      offer_id: offerId,
      offer: { type: "offer", sdp: await sealSignal(opts.signal, opts.discovery, "offer", offerId, sdp, random) },
    };
  }

  async function announce() {
    if (closed) return;
    for (const [id, o] of pending)
      if (clock.now() - o.at > OFFER_TTL_MS) {
        o.pc.close();
        pending.delete(id);
      }
    const room = maxPeers - peers.size;
    const n = Math.max(0, Math.min(offersPerAnnounce, room));
    const offers = (await Promise.all(Array.from({ length: n }, () => makeOffer()))).filter((o) => o !== undefined);
    for (const ws of sockets)
      send(ws, {
        action: "announce",
        info_hash: infoHash,
        peer_id: selfId,
        numwant: offers.length,
        uploaded: 0,
        downloaded: 0,
        offers,
      });
    event(
      `announce: ${offers.length} encrypted offers to ${sockets.filter((s) => s.readyState === 1).length} trackers`,
    );
  }

  function schedule(seconds: number) {
    cancelTimer?.();
    if (!closed)
      cancelTimer = clock.after(seconds * 1000, () => void announce().then(() => schedule(opts.announceSeconds ?? 30)));
  }

  async function onTrackerMessage(ws: WebSocket, raw: unknown) {
    if (closed || typeof raw !== "string" || raw.length > 256 * 1024) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.info_hash !== infoHash || typeof msg.peer_id !== "string" || msg.peer_id === selfId) {
      if (typeof msg.interval === "number" && msg.interval >= 10) schedule(Math.min(msg.interval, 120));
      return;
    }
    const from = hex(msg.peer_id);
    const offerId = typeof msg.offer_id === "string" ? msg.offer_id : undefined;
    if (!offerId || offerId.length !== 20) return;
    const offer = msg.offer as { sdp?: unknown } | undefined;
    const answer = msg.answer as { sdp?: unknown } | undefined;
    if (offer) {
      if (peers.has(from) || peers.size >= maxPeers) return;
      // One connection per pair: only the greater id answers. The lesser re-announces soon instead.
      if (self < from) {
        if (clock.now() - lastQuickAnnounce > 5_000) {
          lastQuickAnnounce = clock.now();
          schedule(0.5);
        }
        return;
      }
      const sdp = await openSignal(opts.signal, opts.discovery, "offer", offerId, offer.sdp);
      if (!sdp || closed || peers.has(from))
        return event(sdp ? "offer ignored" : "offer from another room or tampered: ignored");
      const pc = new PC(config());
      const peer: Peer = { id: from, pc, open: false, nextMsg: 1, partial: new Map() };
      peers.set(from, peer);
      pc.ondatachannel = (e) => attach(peer, e.channel);
      pc.onconnectionstatechange = () => ["failed", "closed"].includes(pc.connectionState) && drop(from);
      try {
        await pc.setRemoteDescription({ type: "offer", sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        const local = pc.localDescription?.sdp;
        if (!local) return drop(from);
        send(ws, {
          action: "announce",
          info_hash: infoHash,
          peer_id: selfId,
          to_peer_id: msg.peer_id,
          offer_id: offerId,
          answer: {
            type: "answer",
            sdp: await sealSignal(opts.signal, opts.discovery, "answer", offerId, local, random),
          },
        });
        event("answered an offer");
      } catch {
        drop(from);
      }
    } else if (answer) {
      const waiting = pending.get(offerId);
      if (!waiting || peers.has(from)) return;
      const sdp = await openSignal(opts.signal, opts.discovery, "answer", offerId, answer.sdp);
      if (!sdp) return event("answer from another room or tampered: ignored");
      pending.delete(offerId);
      const peer: Peer = { id: from, pc: waiting.pc, open: false, nextMsg: 1, partial: new Map() };
      peers.set(from, peer);
      attach(peer, waiting.channel);
      waiting.pc.onconnectionstatechange = () =>
        ["failed", "closed"].includes(waiting.pc.connectionState) && drop(from);
      try {
        await waiting.pc.setRemoteDescription({ type: "answer", sdp });
      } catch {
        drop(from);
      }
    }
  }

  for (const url of opts.trackers) {
    if (!/^wss:\/\//.test(url) && !/^ws:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) continue;
    const ws = new WS(url);
    sockets.push(ws);
    ws.onopen = () => {
      event("tracker connected");
      void announce();
    };
    ws.onmessage = (e: MessageEvent) => void onTrackerMessage(ws, e.data);
    ws.onclose = () => event("tracker closed");
    ws.onerror = () => event("tracker error");
  }
  schedule(opts.announceSeconds ?? 30);

  return {
    capabilities: { kind: "webrtc-tracker", durable: false, maxFrameBytes },
    self,
    peers: () => [...peers.values()].filter((p) => p.open).map((p) => p.id),
    send(bytes, to) {
      if (closed) return;
      if (bytes.length > maxFrameBytes) throw new FrameTooLargeError(bytes.length, maxFrameBytes);
      const targets = [...peers.values()].filter((p) => p.open && (to === undefined || p.id === to));
      const total = Math.max(1, Math.ceil(bytes.length / CHUNK));
      for (const peer of targets) {
        const msg = peer.nextMsg++ >>> 0;
        for (let i = 0; i < total; i++) {
          const part = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
          const out = new Uint8Array(CHUNK_HEADER + part.length);
          const v = new DataView(out.buffer);
          v.setUint32(0, msg);
          v.setUint16(4, i);
          v.setUint16(6, total);
          out.set(part, CHUNK_HEADER);
          try {
            peer.channel?.send(out);
          } catch {
            drop(peer.id);
            break;
          }
        }
      }
    },
    subscribe(h) {
      handlers = h;
      return () => {
        if (handlers === h) handlers = undefined;
      };
    },
    close() {
      if (closed) return;
      closed = true;
      cancelTimer?.();
      for (const ws of sockets) {
        send(ws, {
          action: "announce",
          info_hash: infoHash,
          peer_id: selfId,
          event: "stopped",
          numwant: 0,
          uploaded: 0,
          downloaded: 0,
        });
        ws.close();
      }
      for (const o of pending.values()) o.pc.close();
      pending.clear();
      for (const id of [...peers.keys()]) drop(id);
    },
    diagnostics: () => ({
      trackersOpen: sockets.filter((s) => s.readyState === 1).length,
      peers: [...peers.values()].filter((p) => p.open).length,
      pendingOffers: pending.size,
    }),
  };
}

/** The public trackers the spike offers (as Trystero lists them, checked 2026-10-16). Shown before any use. */
export const SPIKE_TRACKERS = [
  "wss://tracker.webtorrent.dev",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];
export const SPIKE_STUN: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
