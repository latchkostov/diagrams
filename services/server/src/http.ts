import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { realClock, type Clock } from "../../../src/collab/clock";
import { RELAY_CLOSE, RELAY_SUBPROTOCOL } from "../../../src/collab/transport/relayProtocol";
import { createAdmission, type Admission, type Principal, type Refusal } from "./admission";
import { attachConnection } from "./collab/connection";
import { OutboundBudget } from "./collab/outbound";
import { MemoryRoomRegistry, type RoomRegistry } from "./collab/rooms";
import { readConfig, type ServerConfig } from "./config";
import { createLog, type Logger } from "./log";
import { validateMemoryBudget } from "./memory";
import { Metrics, type RefusalReason } from "./metrics";
import { createStaticHandler, requestPath } from "./static";

/** Config and static files are validated before accepting traffic. No diagram content is inspected. */
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
  validateMemoryBudget(config);
  const admission = opts.admission ?? createAdmission(config);
  const rooms = opts.rooms ?? new MemoryRoomRegistry(config.roomCap, config.maxRooms);
  const log = opts.log ?? createLog();
  const metrics = new Metrics();
  const outbound = new OutboundBudget(
    config,
    (n) => {
      metrics.bytesOut += n;
    },
    () => refuse("buffers", RELAY_CLOSE.rate),
  );
  const clock = opts.clock ?? realClock;
  let draining = false;
  let ready = false;
  let staticHandler: Awaited<ReturnType<typeof createStaticHandler>> | undefined;
  const sockets = new Set<Socket>();
  let closing: Promise<void> | undefined;
  let nextPeer = 0n;
  let admitted = 0;
  const refuse = (reason: RefusalReason, code: number) => {
    metrics.refuse(reason);
    log("refused", code);
  };
  const server = createServer((req, res) => {
    const path = requestPath(req.url ?? "/");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (path === "/healthz" || path === "/readyz") {
      const healthy = path === "/healthz" || (ready && !draining);
      res
        .writeHead(healthy ? 200 : 503, { "Content-Type": "text/plain; charset=utf-8" })
        .end(healthy ? "ok\n" : "not ready\n");
      return;
    }
    if (path === "/metrics" && config.metrics) {
      res
        .writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" })
        .end(metrics.render(rooms, wss.clients.size, outbound.bufferedBytes, config));
      return;
    }
    const reserved =
      path === `${config.base}api` ||
      path === `${config.base}collab` ||
      path?.startsWith(`${config.base}api/`) ||
      path?.startsWith(`${config.base}collab/`);
    if (reserved || path === "/metrics") {
      res.writeHead(reserved ? 501 : 404).end();
      return;
    }
    if (staticHandler) {
      void staticHandler(req, res).catch(() => {
        log("http-error");
        if (!res.headersSent) res.writeHead(500, { "Cache-Control": "no-store" });
        res.end();
      });
      return;
    }
    res.writeHead(path ? 404 : 400).end();
  });
  server.maxHeadersCount = 100;
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("close", () => {
    ready = false;
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayload,
    perMessageDeflate: false,
    autoPong: false,
    handleProtocols: (protocols) => (protocols.has(RELAY_SUBPROTOCOL) ? RELAY_SUBPROTOCOL : false),
  });
  wss.on("close", () => {
    ready = false;
  });
  const rejectUpgrade = (socket: Duplex, status: number) => {
    const reason = {
      400: "Bad Request",
      403: "Forbidden",
      404: "Not Found",
      429: "Too Many Requests",
      503: "Service Unavailable",
    }[status];
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };
  wss.on("wsClientError", (_error, socket) => {
    refuse("protocol", RELAY_CLOSE.badFrame);
    rejectUpgrade(socket, 400);
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== `${config.base}collab/v1` ||
      !req.headers["sec-websocket-protocol"]
        ?.split(",")
        .map((s) => s.trim())
        .includes(RELAY_SUBPROTOCOL)
    ) {
      rejectUpgrade(socket, 404);
      return;
    }
    const principal: Principal | Refusal = draining
      ? { code: RELAY_CLOSE.restart, reason: "draining" }
      : admitted >= config.maxSockets
        ? { code: RELAY_CLOSE.rate, reason: "socket-cap" }
        : !outbound.canTrack
          ? { code: RELAY_CLOSE.rate, reason: "buffers" }
          : admission.admit(req);
    if ("code" in principal) {
      refuse(principal.reason, principal.code);
      rejectUpgrade(socket, principal.reason === "origin" ? 403 : principal.reason === "ip-cap" ? 429 : 503);
      return;
    }
    // Reserve the IP through handshake failure too; ws may reject malformed upgrade headers.
    admitted++;
    socket.once("close", () => {
      admitted--;
      admission.release(principal);
    });
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => {});
      outbound.track(ws);
      if (config.logIps) log("joined", undefined, principal.ip);
      attachConnection({
        socket: ws,
        peer: (++nextPeer).toString(16).padStart(16, "0"),
        config,
        rooms,
        clock: opts.clock,
        log,
        outbound,
        onBytes: (n) => {
          metrics.bytesIn += n;
        },
        onDropped: () => {
          metrics.framesDropped++;
        },
        onRefusal: (code) =>
          refuse(
            code === RELAY_CLOSE.removed
              ? "removed"
              : code === RELAY_CLOSE.badFrame
                ? "protocol"
                : code === RELAY_CLOSE.full
                  ? "room-cap"
                  : code === RELAY_CLOSE.serverFull
                    ? "server-cap"
                    : code === RELAY_CLOSE.tooBig
                      ? "size"
                      : "rate",
            code,
          ),
      });
      wss.emit("connection", ws, req);
    });
  });
  return {
    server,
    rooms,
    wss,
    outbound,
    async listen(): Promise<string> {
      if (config.static) staticHandler = await createStaticHandler(config.staticDir, config.base);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      ready = !draining;
      return `http://127.0.0.1:${address.port}`;
    },
    drain() {
      if (draining) return;
      draining = true;
      log("draining");
      for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) outbound.close(ws, RELAY_CLOSE.restart);
    },
    /** Signals use this bounded shutdown; drain() alone supports a readiness-removal grace phase. */
    shutdown(): Promise<void> {
      if (closing) return closing;
      this.drain();
      closing = (async () => {
        const cancel = clock.after(config.drainTimeoutMs, () => {
          for (const ws of wss.clients) ws.terminate();
          for (const socket of sockets) socket.destroy();
        });
        try {
          await Promise.all([
            new Promise<void>((resolve) => wss.close(() => resolve())),
            new Promise<void>((resolve) => server.close(() => resolve())),
          ]);
          log("stopped");
        } finally {
          cancel();
        }
      })();
      return closing;
    },
    async close(): Promise<void> {
      draining = true;
      for (const ws of wss.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      if (closing) {
        await closing;
        return;
      }
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    },
  };
}
