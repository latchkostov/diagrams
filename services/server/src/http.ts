import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Clock } from "../../../src/collab/clock";
import { RELAY_CLOSE, RELAY_SUBPROTOCOL } from "../../../src/collab/transport/relayProtocol";
import { createAdmission, type Admission } from "./admission";
import { attachConnection } from "./collab/connection";
import { MemoryRoomRegistry, type RoomRegistry } from "./collab/rooms";
import { readConfig, type ServerConfig } from "./config";
import { createLog, type Logger } from "./log";

/** S1 reserves the application routes; static hosting and richer operational endpoints follow in S2. */
export function createRelayServer(
  opts: {
    config?: ServerConfig;
    admission?: Admission;
    rooms?: RoomRegistry;
    clock?: Clock;
    log?: Logger;
  } = {},
) {
  const config = opts.config ?? readConfig();
  const admission = opts.admission ?? createAdmission(config);
  const rooms = opts.rooms ?? new MemoryRoomRegistry(config.roomCap, config.maxRooms);
  const log = opts.log ?? createLog();
  let draining = false;
  let nextPeer = 0n;
  let bytesIn = 0;
  const refusals = new Map<string, number>();
  const refuse = (reason: string, code: number) => {
    refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
    log("refused", code);
  };
  const server = createServer((req, res) => {
    const path = req.url;
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (path === "/healthz" || path === "/readyz") {
      res.writeHead(path === "/readyz" && draining ? 503 : 200, { "Content-Type": "text/plain" }).end("ok\n");
      return;
    }
    if (path === "/metrics" && config.metrics) {
      const text = [
        `rooms_active ${rooms.size}`,
        `sockets_active ${wss.clients.size}`,
        `bytes_in_total ${bytesIn}`,
        ...[...refusals].map(([reason, n]) => `refusals_total{reason="${reason}"} ${n}`),
      ];
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" }).end(`${text.join("\n")}\n`);
      return;
    }
    const reserved = path?.startsWith(`${config.base}api/`) || path?.startsWith(`${config.base}collab/`);
    res.writeHead(reserved ? 501 : 404).end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayload,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has(RELAY_SUBPROTOCOL) ? RELAY_SUBPROTOCOL : false),
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== `${config.base}collab/v1` ||
      !req.headers["sec-websocket-protocol"]
        ?.split(",")
        .map((s) => s.trim())
        .includes(RELAY_SUBPROTOCOL)
    ) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const buffers = [...wss.clients].reduce((n, client) => n + client.bufferedAmount, 0);
      const principal = draining
        ? { code: RELAY_CLOSE.restart, reason: "draining" }
        : wss.clients.size > config.maxSockets
          ? { code: RELAY_CLOSE.rate, reason: "socket-cap" }
          : buffers >= config.totalBufferBytes
            ? { code: RELAY_CLOSE.rate, reason: "buffers" }
            : admission.admit(req);
      // Even refusals complete the handshake, so browser clients receive the specified application close code.
      ws.on("error", () => {});
      if ("code" in principal) {
        refuse(principal.reason, principal.code);
        ws.close(principal.code);
        return;
      }
      ws.once("close", () => admission.release(principal));
      if (config.logIps) log("joined", undefined, principal.ip);
      attachConnection({
        socket: ws,
        peer: (++nextPeer).toString(16).padStart(16, "0"),
        config,
        rooms,
        clock: opts.clock,
        log,
        onBytes: (n) => {
          bytesIn += n;
        },
        onRefusal: (code) => refuse(String(code), code),
        canJoin: () => [...wss.clients].reduce((n, client) => n + client.bufferedAmount, 0) < config.totalBufferBytes,
      });
      wss.emit("connection", ws, req);
    });
  });
  return {
    server,
    rooms,
    wss,
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      return `http://127.0.0.1:${address.port}`;
    },
    drain() {
      draining = true;
      for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.close(RELAY_CLOSE.restart);
    },
    async close(): Promise<void> {
      draining = true;
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    },
  };
}
