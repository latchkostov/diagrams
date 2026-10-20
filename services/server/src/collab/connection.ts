import type { WebSocket, RawData } from "ws";
import { realClock, type Clock } from "../../../../src/collab/clock";
import {
  parseHello,
  readClientFrame,
  serverFrame,
  RELAY_CLOSE,
  RELAY_LIMITS,
} from "../../../../src/collab/transport/relayProtocol";
import type { ServerConfig } from "../config";
import type { Logger } from "../log";
import type { RoomRegistry } from "./rooms";
import type { OutboundBudget } from "./outbound";

export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(
    private capacity: number,
    private perMs: number,
    private clock: Clock,
  ) {
    this.tokens = capacity;
    this.at = clock.now();
  }
  take(amount: number): boolean {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.at) * this.perMs);
    this.at = now;
    if (amount > this.tokens) return false;
    this.tokens -= amount;
    return true;
  }
}

export const rawBytes = (raw: RawData): Uint8Array =>
  Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;

export function attachConnection(opts: {
  socket: WebSocket;
  peer: string;
  config: ServerConfig;
  rooms: RoomRegistry;
  log: Logger;
  outbound: OutboundBudget;
  clock?: Clock;
  onBytes?: (bytes: number) => void;
  onRefusal?: (code: number) => void;
}): void {
  const { socket, peer, config, rooms, log, outbound } = opts;
  const clock = opts.clock ?? realClock;
  let roomId: string | undefined;
  let done = false;
  let lastData = clock.now();
  let missed = 0;
  const bytes = new TokenBucket(config.bytesPerWindow, config.bytesPerWindow / config.windowMs, clock);
  const frames = new TokenBucket(config.frameBurst, config.framesPerSecond / 1000, clock);
  const send = (target: WebSocket, data: string | Uint8Array) => outbound.send(target, data);
  const cleanup = () => {
    if (done) return;
    done = true;
    cancelHello();
    cancelPing();
    if (roomId) {
      const room = rooms.get(roomId);
      rooms.leave(roomId, peer);
      for (const target of room?.peers.values() ?? []) send(target, JSON.stringify({ t: "leave", peer }));
    }
  };
  const refuse = (code: number) => {
    if (done) return;
    opts.onRefusal?.(code);
    cleanup();
    outbound.close(socket, code);
  };
  const cancelHello = clock.after(config.helloTimeoutMs, () => refuse(RELAY_CLOSE.badFrame));
  const cancelPing = clock.every(config.pingIntervalMs, () => {
    if (clock.now() - lastData >= config.idleTimeoutMs || missed >= config.missedPongs) {
      cleanup();
      socket.terminate();
      return;
    }
    missed++;
    outbound.ping(socket);
  });
  socket.on("ping", (data) => outbound.pong(socket, data));
  socket.on("pong", () => {
    missed = 0;
  });
  socket.on("close", (code) => {
    cleanup();
    log("closed", code);
  });
  socket.on("error", (error: Error & { code?: string }) => {
    if (error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") opts.onRefusal?.(RELAY_CLOSE.tooBig);
    cleanup();
    log("socket-error");
  });
  socket.on("message", (raw, binary) => {
    if (done) return;
    const data = rawBytes(raw);
    opts.onBytes?.(data.length);
    lastData = clock.now();
    if (!bytes.take(data.length) || !frames.take(1)) {
      refuse(RELAY_CLOSE.rate);
      return;
    }
    if (data.length > config.maxPayload) {
      refuse(RELAY_CLOSE.tooBig);
      return;
    }
    if (roomId === undefined) {
      const hello = binary ? undefined : parseHello(Buffer.from(data).toString("utf8"));
      if (!hello) {
        refuse(RELAY_CLOSE.badFrame);
        return;
      }
      const room = rooms.join(hello.room, peer, socket);
      if (!room) {
        refuse(rooms.get(hello.room) ? RELAY_CLOSE.full : RELAY_CLOSE.serverFull);
        return;
      }
      roomId = hello.room;
      cancelHello();
      const peers = [...room.peers.keys()].filter((id) => id !== peer);
      send(
        socket,
        JSON.stringify({
          t: "welcome",
          self: peer,
          peers,
          cap: config.roomCap,
          maxFrame: Math.min(RELAY_LIMITS.maxFrameBytes, config.maxPayload - 9),
          durable: false,
        }),
      );
      for (const [id, target] of room.peers) if (id !== peer) send(target, JSON.stringify({ t: "join", peer }));
      log("joined");
      return;
    }
    const frame = binary ? readClientFrame(data) : undefined;
    if (!frame) {
      refuse(RELAY_CLOSE.badFrame);
      return;
    }
    if (frame.envelope.length > Math.min(RELAY_LIMITS.maxFrameBytes, config.maxPayload - 9)) {
      refuse(RELAY_CLOSE.tooBig);
      return;
    }
    const out = serverFrame(frame.envelope, peer);
    for (const [id, target] of rooms.get(roomId)?.peers ?? [])
      if (id !== peer && (frame.to === undefined || id === frame.to)) send(target, out);
  });
}
