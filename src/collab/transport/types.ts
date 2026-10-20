import type { ChainData } from "../epochs";
// The transport interface (docs/research/collaboration.md, "Do we need a backend? Hybrid transport plan"): how a
// room's ciphertext frames move between browsers, and nothing else. A transport never sees a key that opens the
// diagram or presence, nor plaintext: it carries the opaque envelopes of ../envelope.ts. Its peer ids are its own
// (untrusted); who wrote a frame is decided by the envelope, never by the transport.
//
// Every transport must pass the conformance harness (./conformance.ts) before a session may use it: the in-memory
// transport here, the public-matchmaking WebRTC spike (./tracker.ts, run by hand in the Lab), and any future one
// (a Trystero-style strategy, or an optional relay if the owner ever approves operating one).

/** A transport's id for a connected peer. Opaque and untrusted. */
export type PeerId = string;

export type Connectivity =
  | "waiting"
  | "connected"
  | "trackers-unreachable"
  | "no-answer"
  | "ice-failed"
  | "peer-left"
  | "server-unreachable"
  | "room-full"
  | "server-full";

export interface TransportCapabilities {
  /** What it is, for diagnostics ("memory", "webrtc-tracker"). */
  kind: string;
  /** Whether frames are stored anywhere after delivery. No C0 transport stores anything. */
  durable: false;
  /** The largest frame `send` accepts; larger throws. */
  maxFrameBytes: number;
}

export interface TransportHandlers {
  /**
   * A frame from `from`. The bytes are the receiver's own copy. May return a promise: a transport delivers a
   * peer's next frame only after it settles (per-peer order is the transport's to keep or not).
   */
  frame(from: PeerId, bytes: Uint8Array): void | Promise<void>;
  /** A peer became reachable. */
  join(peer: PeerId): void;
  /** A peer became unreachable (left, partitioned, disconnected). */
  leave(peer: PeerId): void;
  /** Discovery or handshake state changed, even when no data channel has opened. */
  connectivity?(): void;
}

/**
 * A knock-to-join room's admission, for a relay that enforces it (shared Live P6): the session says which member this
 * page is (a signature over the relay's challenge) and hands the room's chain on (public keys and signatures only).
 */
export interface RelayAdmission {
  /** The member key this page speaks for, and its signature over the relay's challenge to this socket. */
  prove(challenge: string, peer: PeerId): Promise<{ key: string; sig: string }>;
  /** The room's chain as this page holds it, in pieces a relay message holds (none at the door). */
  chain(): ChainData[];
  /** What changed last: the newest epochs (a removal, its new epoch, a roster entry). */
  recent(): ChainData | undefined;
  /** Whether this page is in the room (so a relay that hasn't admitted it is missing some of the chain). */
  member(): boolean;
  subscribe(fn: () => void): () => void;
}

export interface CollabTransport {
  readonly capabilities: TransportCapabilities;
  /** This end's transport id. */
  readonly self: PeerId;
  /** Peers reachable now. */
  peers(): readonly PeerId[];
  /** Optional discovery diagnostics; a transport without discovery can simply wait for peers. */
  connectivity?(): Connectivity;
  /**
   * Sends a frame to one peer, or to every reachable peer without `to`. Fire-and-forget: frames may be dropped,
   * duplicated or reordered (sessions are built for that). Never delivers to the sender itself. The transport
   * copies `bytes` before returning; later changes by the caller don't affect what's delivered.
   */
  send(bytes: Uint8Array, to?: PeerId): void;
  /** One set of handlers at a time; returns an unsubscribe. */
  subscribe(handlers: TransportHandlers): () => void;
  /** A relay that enforces knock-to-join rooms: how this page is admitted (other transports have none). */
  authorize?(admission: RelayAdmission): void;
  /** Explicit retry of discovery, preserving the session and its document. */
  retry?(): void;
  /** Leaves: nothing more is sent or delivered, and peers see `leave`. Idempotent. */
  close(): void;
}

export class FrameTooLargeError extends Error {
  constructor(size: number, max: number) {
    super(`That frame is ${size} bytes; this transport carries at most ${max}.`);
    this.name = "FrameTooLargeError";
  }
}
