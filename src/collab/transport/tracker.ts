import { base64UrlToBytes, bytesToBase64Url, bytesToText, textToBytes } from "../../interop/codec";
import { realClock, type Clock } from "../clock";
import { COLLAB_LIMITS } from "../limits";
import { secureRandom, type RandomBytes } from "../random";
import {
  FrameTooLargeError,
  type CollabTransport,
  type Connectivity,
  type PeerId,
  type TransportHandlers,
} from "./types";

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
const RECONNECT_MAX_MS = 120_000;

interface Tracker {
  url: string;
  ws?: WebSocket;
  periodicSeconds: number;
  due: number;
  quick?: boolean;
  cancelAnnounce?: () => void;
  cancelReconnect?: () => void;
  failures: number;
  openedAt?: number;
  lastQuickAnnounce: number;
  quickFor: Map<PeerId, number>;
}

const latin1 = (b: Uint8Array) => String.fromCharCode(...b);
const fromLatin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const hex = (s: string) => Array.from(fromLatin1(s), (x) => x.toString(16).padStart(2, "0")).join("");

const signalAad = (discovery: Uint8Array, kind: string, offerId: string, signer: string) =>
  textToBytes(`livediagrams/collab/v1/signal/${kind}/${bytesToBase64Url(discovery)}/${hex(offerId)}/${hex(signer)}`);

/**
 * Encrypts an SDP for the tracker, bound to the room, the direction, the offer id and the signer's tracker peer id:
 * a tracker replaying it under another peer id, or as the other direction, produces something that doesn't open.
 */
export async function sealSignal(
  key: CryptoKey,
  discovery: Uint8Array,
  kind: "offer" | "answer",
  offerId: string,
  signer: string,
  sdp: string,
  random: RandomBytes,
): Promise<string> {
  const iv = random(12);
  const aad = signalAad(discovery, kind, offerId, signer);
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
  signer: string,
  sealed: unknown,
): Promise<string | undefined> {
  if (typeof sealed !== "string" || !sealed.startsWith(SIGNAL_PREFIX) || sealed.length > 64 * 1024) return undefined;
  try {
    const bytes = base64UrlToBytes(sealed.slice(SIGNAL_PREFIX.length));
    if (bytes.length < 12 + 16) return undefined;
    const aad = signalAad(discovery, kind, offerId, signer);
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
  diagnostics(): { trackersOpen: number; peers: number; pendingOffers: number; connectivity: Connectivity };
  /** Resolves once no signalling work is in flight (tests drain the offline fake with it). */
  settled(): Promise<void>;
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
  let discoveryAttempt = 0;
  const creatingOffers = new Set<RTCPeerConnection>();
  const trackers: Tracker[] = [...new Set(opts.trackers)]
    .filter((url) => /^wss:\/\//.test(url) || /^ws:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))
    .map((url) => ({
      url,
      periodicSeconds: opts.announceSeconds ?? 30,
      due: Infinity,
      failures: 0,
      lastQuickAnnounce: -Infinity,
      quickFor: new Map(),
    }));
  const sockets = () => trackers.flatMap((t) => (t.ws ? [t.ws] : []));
  const peers = new Map<PeerId, Peer>();
  /** The signalling socket owns a handshake until its data channel opens. */
  const handshakes = new Map<Peer, WebSocket>();
  /** Our outstanding offers by offer id: the connection waiting for an answer. */
  const pending = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel; at: number }>();
  let handshakeFailed = false;
  let peerLeft = false;
  const connectivity = (): Connectivity => {
    if ([...peers.values()].some((p) => p.open)) return "connected";
    if (handshakeFailed) return "ice-failed";
    if (peers.size) return "no-answer";
    if (!sockets().some((s) => s.readyState === 1)) return "trackers-unreachable";
    return peerLeft ? "peer-left" : "waiting";
  };
  const changed = () => handlers?.connectivity?.();
  const seenOffers = new Set<string>();
  /** Signalling work in flight (announces, tracker messages). */
  const inflight = new Set<Promise<unknown>>();
  const track = (work: Promise<unknown>) => {
    const p = work.catch(() => {}).finally(() => inflight.delete(p));
    inflight.add(p);
    return p;
  };

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
      if (closed || peer.open || peers.get(peer.id) !== peer) return;
      peer.open = true;
      handshakes.delete(peer);
      handshakeFailed = false;
      event("peer connected");
      handlers?.join(peer.id);
      changed();
    };
    channel.onclose = () => drop(peer.id, peer);
    channel.onmessage = (e: MessageEvent) => receive(peer, e.data);
  }

  function drop(id: PeerId, expected?: Peer) {
    const peer = peers.get(id);
    if (!peer || (expected && peer !== expected)) return;
    peers.delete(id);
    handshakes.delete(peer);
    try {
      peer.channel?.close();
      peer.pc.close();
    } catch {
      /* already closed */
    }
    if (peer.open) {
      peerLeft = true;
      event("peer left");
      handlers?.leave(id);
    }
    changed();
  }

  function watchConnection(peer: Peer) {
    const update = () => {
      if (peers.get(peer.id) !== peer) return;
      if (peer.pc.connectionState === "failed" || peer.pc.iceConnectionState === "failed") {
        if (!peer.open) handshakeFailed = true;
        drop(peer.id, peer);
      } else if (peer.pc.connectionState === "closed") drop(peer.id, peer);
    };
    peer.pc.onconnectionstatechange = update;
    peer.pc.oniceconnectionstatechange = update;
  }

  function receive(peer: Peer, data: unknown) {
    if (peers.get(peer.id) !== peer) return;
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
    const attempt = discoveryAttempt;
    const pc = new PC(config());
    creatingOffers.add(pc);
    const channel = pc.createDataChannel("ld", { ordered: true });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
    } catch {
      pc.close();
      return undefined;
    } finally {
      creatingOffers.delete(pc);
    }
    const offerId = latin1(random(20));
    const sdp = pc.localDescription?.sdp;
    if (!sdp || closed || attempt !== discoveryAttempt) {
      pc.close();
      return undefined;
    }
    pending.set(offerId, { pc, channel, at: clock.now() });
    const sealed = await sealSignal(opts.signal, opts.discovery, "offer", offerId, selfId, sdp, random);
    if (closed || attempt !== discoveryAttempt) return undefined;
    return {
      offer_id: offerId,
      offer: {
        type: "offer",
        sdp: sealed,
      },
    };
  }

  /** Each tracker owns its announce schedule, including quick replies to peers it discovered. */
  async function announce(tracker: Tracker) {
    const ws = tracker.ws;
    if (closed || !ws || ws.readyState !== 1) return;
    const attempt = discoveryAttempt;
    for (const [id, o] of pending)
      if (clock.now() - o.at > OFFER_TTL_MS) {
        o.pc.close();
        pending.delete(id);
      }
    const room = maxPeers - peers.size;
    const n = Math.max(0, Math.min(offersPerAnnounce, room));
    const offers = (await Promise.all(Array.from({ length: n }, () => makeOffer()))).filter((o) => o !== undefined);
    if (closed || attempt !== discoveryAttempt) return;
    if (tracker.ws === ws && ws.readyState === 1)
      send(ws, {
        action: "announce",
        info_hash: infoHash,
        peer_id: selfId,
        numwant: offers.length,
        uploaded: 0,
        downloaded: 0,
        offers,
      });
    event(`announce: ${offers.length} encrypted offers to 1 tracker`);
  }

  function schedule(tracker: Tracker, seconds: number, quick = false) {
    const due = clock.now() + seconds * 1000;
    if (closed || tracker.ws?.readyState !== 1 || due >= tracker.due) return;
    tracker.cancelAnnounce?.();
    tracker.due = due;
    tracker.quick = quick;
    const attempt = discoveryAttempt;
    tracker.cancelAnnounce = clock.after(seconds * 1000, () => {
      tracker.due = Infinity;
      tracker.quick = false;
      tracker.cancelAnnounce = undefined;
      void track(
        announce(tracker).then(() => {
          if (attempt === discoveryAttempt) schedule(tracker, tracker.periodicSeconds);
        }),
      );
    });
  }

  async function onTrackerMessage(tracker: Tracker, ws: WebSocket, raw: unknown) {
    if (closed || typeof raw !== "string" || raw.length > 256 * 1024) return;
    const attempt = discoveryAttempt;
    const obsolete = () => closed || attempt !== discoveryAttempt || tracker.ws !== ws || ws.readyState !== 1;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.info_hash !== infoHash) return;
    if (typeof msg.peer_id !== "string" || msg.peer_id === selfId) {
      if (typeof msg.interval === "number" && Number.isFinite(msg.interval) && msg.interval >= 10) {
        tracker.periodicSeconds = Math.min(msg.interval, 120);
        // Periodic interval changes must never postpone a quick reply to a discovered peer.
        if (!tracker.quick) {
          tracker.cancelAnnounce?.();
          tracker.due = Infinity;
        }
        schedule(tracker, tracker.periodicSeconds);
      }
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
      // Each greater peer gets a quick response at most every 5 s, and the quick announces themselves go out at most
      // once a second (a newcomer is never left waiting for the slow periodic announce).
      if (self < from) {
        const now = clock.now();
        if (now - (tracker.quickFor.get(from) ?? -Infinity) > 5_000) {
          if (tracker.quickFor.size >= 256) tracker.quickFor.clear();
          tracker.quickFor.set(from, now);
          // One already on its way serves this peer too.
          if (!(tracker.lastQuickAnnounce > now)) {
            tracker.lastQuickAnnounce = Math.max(now + 500, tracker.lastQuickAnnounce + 1_000);
            schedule(tracker, (tracker.lastQuickAnnounce - now) / 1000, true);
          }
        }
        return;
      }
      // Each offer is considered once (a tracker replaying it gets nowhere), and the peer budget is checked again
      // after the await: offers that arrived together must not all be admitted.
      // Only authenticated offers are remembered (by signer and offer id), so a forgery reusing an offer id can't
      // block the genuine offer arriving through another tracker.
      const seen = `${msg.peer_id}|${offerId}`;
      if (seenOffers.has(seen)) return;
      const sdp = await openSignal(opts.signal, opts.discovery, "offer", offerId, msg.peer_id, offer.sdp);
      if (obsolete()) return;
      if (!sdp) return event("offer from another room, replayed or tampered: ignored");
      if (seenOffers.has(seen)) return;
      if (seenOffers.size >= 4096) seenOffers.clear();
      seenOffers.add(seen);
      if (closed || peers.has(from) || peers.size >= maxPeers) return event("offer ignored");
      const pc = new PC(config());
      const peer: Peer = { id: from, pc, open: false, nextMsg: 1, partial: new Map() };
      peers.set(from, peer);
      handshakes.set(peer, ws);
      changed();
      pc.ondatachannel = (e) => {
        if (peers.get(from) === peer) attach(peer, e.channel);
        else e.channel.close();
      };
      watchConnection(peer);
      let answered = false;
      const abandoned = () => obsolete() || peers.get(from) !== peer;
      try {
        await pc.setRemoteDescription({ type: "offer", sdp });
        if (abandoned()) return;
        const answer = await pc.createAnswer();
        if (abandoned()) return;
        await pc.setLocalDescription(answer);
        if (abandoned()) return;
        await gathered(pc);
        if (abandoned()) return;
        const local = pc.localDescription?.sdp;
        if (!local) return drop(from, peer);
        const sealed = await sealSignal(opts.signal, opts.discovery, "answer", offerId, selfId, local, random);
        if (abandoned()) return;
        send(ws, {
          action: "announce",
          info_hash: infoHash,
          peer_id: selfId,
          to_peer_id: msg.peer_id,
          offer_id: offerId,
          answer: {
            type: "answer",
            sdp: sealed,
          },
        });
        answered = true;
        event("answered an offer");
      } catch {
        if (!obsolete()) handshakeFailed = true;
      } finally {
        // Every abandoned continuation owns only this unfinished peer, never a replacement or an open channel.
        if (!answered && !peer.open) drop(from, peer);
      }
    } else if (answer) {
      const waiting = pending.get(offerId);
      if (!waiting || peers.has(from)) return;
      const sdp = await openSignal(opts.signal, opts.discovery, "answer", offerId, msg.peer_id, answer.sdp);
      if (obsolete()) return;
      if (!sdp) return event("answer from another room, replayed or tampered: ignored");
      if (closed || !pending.has(offerId) || peers.has(from) || peers.size >= maxPeers) return;
      pending.delete(offerId);
      const peer: Peer = { id: from, pc: waiting.pc, open: false, nextMsg: 1, partial: new Map() };
      peers.set(from, peer);
      handshakes.set(peer, ws);
      changed();
      attach(peer, waiting.channel);
      watchConnection(peer);
      try {
        await waiting.pc.setRemoteDescription({ type: "answer", sdp });
      } catch {
        if (!obsolete()) handshakeFailed = true;
        if (!peer.open) drop(from, peer);
      } finally {
        if (obsolete() && !peer.open) drop(from, peer);
      }
    }
  }

  function reconnect(tracker: Tracker) {
    if (closed || tracker.cancelReconnect) return;
    const base = Math.min(RECONNECT_MAX_MS, 1_000 * 2 ** Math.min(tracker.failures++, 7));
    const delay = base * (0.5 + random(1)[0] / 510);
    tracker.cancelReconnect = clock.after(delay, () => {
      tracker.cancelReconnect = undefined;
      connectTracker(tracker);
    });
  }
  function connectTracker(tracker: Tracker) {
    if (closed) return;
    try {
      const ws = new WS(tracker.url);
      tracker.ws = ws;
      ws.onopen = () => {
        tracker.openedAt = clock.now();
        event("tracker connected");
        changed();
        void track(announce(tracker).then(() => schedule(tracker, tracker.periodicSeconds)));
      };
      ws.onmessage = (e: MessageEvent) => void track(onTrackerMessage(tracker, ws, e.data));
      ws.onclose = () => {
        // A socket that only opens long enough to answer and close must still back off.
        if (tracker.openedAt !== undefined && clock.now() - tracker.openedAt >= tracker.periodicSeconds * 1000)
          tracker.failures = 0;
        tracker.openedAt = undefined;
        tracker.cancelAnnounce?.();
        tracker.cancelAnnounce = undefined;
        tracker.due = Infinity;
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        for (const [peer, owner] of handshakes) if (owner === ws && !peer.open) drop(peer.id, peer);
        event("tracker closed");
        changed();
        reconnect(tracker);
      };
      ws.onerror = () => event("tracker error");
    } catch {
      event("tracker error");
      changed();
      reconnect(tracker);
    }
  }
  function resetDiscoveryAttempt() {
    discoveryAttempt++;
    handshakeFailed = false;
    for (const tracker of trackers) {
      tracker.cancelAnnounce?.();
      tracker.cancelReconnect?.();
      tracker.cancelAnnounce = tracker.cancelReconnect = undefined;
      tracker.due = Infinity;
      tracker.quickFor.clear();
      tracker.lastQuickAnnounce = -Infinity;
    }
    for (const pc of creatingOffers) pc.close();
    creatingOffers.clear();
    for (const o of pending.values()) o.pc.close();
    pending.clear();
    for (const peer of peers.values()) if (!peer.open) drop(peer.id, peer);
  }
  trackers.forEach(connectTracker);

  return {
    capabilities: { kind: "webrtc-tracker", durable: false, maxFrameBytes },
    self,
    peers: () => [...peers.values()].filter((p) => p.open).map((p) => p.id),
    connectivity,
    retry() {
      if (closed) return;
      resetDiscoveryAttempt();
      for (const ws of sockets()) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      for (const tracker of trackers) {
        tracker.failures = 0;
        tracker.openedAt = undefined;
        tracker.ws = undefined;
        connectTracker(tracker);
      }
      changed();
    },
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
      resetDiscoveryAttempt();
      for (const ws of sockets()) {
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
      for (const id of [...peers.keys()]) drop(id);
    },
    async settled() {
      while (inflight.size) await Promise.all([...inflight]);
    },
    diagnostics: () => ({
      trackersOpen: sockets().filter((s) => s.readyState === 1).length,
      peers: [...peers.values()].filter((p) => p.open).length,
      pendingOffers: pending.size,
      connectivity: connectivity(),
    }),
  };
}

/** The two approved public matchmaking endpoints. Shown before any use; still Lab only. */
export const COLLAB_TRACKERS = ["wss://tracker.openwebtorrent.com", "wss://tracker.webtorrent.dev"];
export const COLLAB_STUN: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
