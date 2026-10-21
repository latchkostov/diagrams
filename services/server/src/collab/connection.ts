import type { WebSocket, RawData } from "ws";
import { realClock, type Clock } from "../../../../src/collab/clock";
import {
  LOBBY_CHANNEL,
  parseClientControl,
  parseHello,
  readClientFrame,
  serverFrame,
  RELAY_CLOSE,
  RELAY_LIMITS,
} from "../../../../src/collab/transport/relayProtocol";
import { TokenBucket } from "./bucket";
import { RoomGuard } from "./guard";
import type { ServerConfig } from "../config";
import type { Logger } from "../log";
import type { RoomRegistry } from "./rooms";
import type { OutboundBudget } from "./outbound";

export { TokenBucket };

/** An envelope's channel (byte 3 of its clear header): the lobby is all a socket that isn't a member may use. */
const channelOf = (envelope: Uint8Array) => (envelope.length > 3 ? envelope[3] : -1);

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
  /** A frame not forwarded: from a socket that isn't a member of its knock-to-join room. */
  onDropped?: () => void;
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
      room?.guard?.leave(peer);
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
      // A knock-to-join room (its root named) admits only its members; every hello names the same root, or none.
      if (hello.root !== undefined && !room.guard && room.peers.size === 1)
        room.guard = new RoomGuard(hello.root, hello.room, clock, {
          verifiesPerSocket: config.verifiesPerSocket,
          verifiesPerRoom: config.verifiesPerRoom,
          windowMs: config.windowMs,
          queuedJobs: config.admissionJobs,
          queuedBytes: config.admissionBytes,
        });
      if (hello.root !== room.guard?.root) {
        rooms.leave(hello.room, peer);
        refuse(RELAY_CLOSE.badFrame);
        return;
      }
      roomId = hello.room;
      cancelHello();
      const challenge = room.guard?.seat(
        peer,
        (code) => {
          log("removed");
          refuse(code);
        },
        (member) => {
          if (member) log("admitted");
          send(socket, JSON.stringify({ t: "status", member }));
        },
        (reply) => send(socket, JSON.stringify(reply)),
      );
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
          ...(challenge ? { challenge } : {}),
        }),
      );
      for (const [id, target] of room.peers) if (id !== peer) send(target, JSON.stringify({ t: "join", peer }));
      log("joined");
      return;
    }
    const guard = rooms.get(roomId)?.guard;
    // A knock-to-join room's socket says which member it is, and pushes the room's chain (checked, signatures only).
    if (!binary && guard) {
      const control = parseClientControl(Buffer.from(data).toString("utf8"));
      if (!control) {
        refuse(RELAY_CLOSE.badFrame);
        return;
      }
      if (control.t === "prove") guard.prove(peer, control.key, control.sig, data.length);
      else guard.push(peer, control.id, control.chain, data.length);
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
    // A knock-to-join room: anyone not admitted sends and gets only the lobby (someone at the door).
    const lobby = channelOf(frame.envelope) === LOBBY_CHANNEL;
    if (guard && !lobby && !guard.isMember(peer)) {
      opts.onDropped?.();
      return;
    }
    const out = serverFrame(frame.envelope, peer);
    for (const [id, target] of rooms.get(roomId)?.peers ?? [])
      if (id !== peer && (frame.to === undefined || id === frame.to) && (!guard || lobby || guard.isMember(id)))
        send(target, out);
  });
}
