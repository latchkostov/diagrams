import { bytesToBase64Url } from "../../interop/codec";
import type { RoomLink } from "../link";
import type { DiagramFile } from "../../model/types";
import { secureRandom } from "../random";
import { realClock, type Clock } from "../clock";
import { COLLAB_LIMITS } from "../limits";
import { FrameTooLargeError, type CollabTransport, type TransportHandlers } from "../transport/types";

/** Lab-only ciphertext wire. Tests relay it between isolated contexts without a public endpoint. */
export interface LabPacket {
  from: string;
  to?: string;
  kind: "hello" | "reply" | "bye" | "frame";
  bytes?: number[];
}
export interface LabWire {
  post(packet: LabPacket): void;
  subscribe(fn: (packet: LabPacket) => void): () => void;
}
export interface CollabLabFixture {
  room: RoomLink;
  wire: LabWire;
  initial?: DiagramFile;
  /** Mount the existing image-export controller for production-browser integration tests. */
  imageExport?: boolean;
}

/** Same-origin tabs only. This is a local Lab transport, never public matchmaking. */
export function broadcastWire(channel: string): LabWire & { close(): void } {
  const broadcast = new BroadcastChannel(`livediagrams-lab/${channel}`);
  return {
    post: (packet) => broadcast.postMessage(packet),
    subscribe(fn) {
      const receive = (e: MessageEvent<LabPacket>) => fn(e.data);
      broadcast.addEventListener("message", receive);
      return () => broadcast.removeEventListener("message", receive);
    },
    close: () => broadcast.close(),
  };
}

declare global {
  interface Window {
    __collabC1?: CollabLabFixture;
  }
}

export function labBridge(
  wire: LabWire,
  clock: Clock = realClock,
): CollabTransport & { suspend(): void; resume(): void } {
  const self = bytesToBase64Url(secureRandom(16));
  const peers = new Map<string, number>();
  let handlers: TransportHandlers | undefined;
  let closed = false;
  let suspended = false;
  const maxFrameBytes = 2 * 1024 * 1024;
  const expire = () => {
    for (const [id, seen] of peers)
      if (clock.now() - seen >= COLLAB_LIMITS.presenceTtlMs) {
        peers.delete(id);
        handlers?.leave(id);
      }
  };
  const heartbeat = clock.every(COLLAB_LIMITS.presenceHeartbeatMs, () => {
    if (suspended || closed) return;
    expire();
    wire.post({ from: self, kind: "hello" });
  });
  const stop = wire.subscribe((p) => {
    if (!p || typeof p.from !== "string" || p.from.length > 64 || !["hello", "reply", "bye", "frame"].includes(p.kind))
      return;
    if (closed || suspended || p.from === self || (p.to && p.to !== self)) return;
    if (p.kind === "bye") {
      peers.delete(p.from);
      handlers?.leave(p.from);
      return;
    }
    if (!peers.has(p.from)) {
      if (peers.size >= COLLAB_LIMITS.maxSenders) return;
      peers.set(p.from, clock.now());
      handlers?.join(p.from);
    }
    peers.set(p.from, clock.now());
    if (p.kind === "hello") wire.post({ from: self, to: p.from, kind: "reply" });
    if (p.kind === "frame" && p.bytes && p.bytes.length <= maxFrameBytes)
      void handlers?.frame(p.from, Uint8Array.from(p.bytes));
  });
  return {
    self,
    capabilities: { kind: "lab-bridge", durable: false, maxFrameBytes },
    peers: () => [...peers.keys()],
    retry() {
      if (!closed && !suspended) wire.post({ from: self, kind: "hello" });
    },
    suspend() {
      if (closed || suspended) return;
      suspended = true;
      wire.post({ from: self, kind: "bye" });
      const departed = [...peers.keys()];
      peers.clear();
      for (const peer of departed) handlers?.leave(peer);
    },
    resume() {
      if (closed || !suspended) return;
      suspended = false;
      wire.post({ from: self, kind: "hello" });
    },
    send(bytes, to) {
      if (closed || suspended) return;
      if (bytes.length > maxFrameBytes) throw new FrameTooLargeError(bytes.length, maxFrameBytes);
      wire.post({ from: self, to, kind: "frame", bytes: [...bytes] });
    },
    subscribe(next) {
      handlers = next;
      wire.post({ from: self, kind: "hello" });
      return () => {
        handlers = undefined;
      };
    },
    close() {
      if (closed) return;
      wire.post({ from: self, kind: "bye" });
      closed = true;
      stop();
      heartbeat();
      peers.clear();
    },
  };
}
