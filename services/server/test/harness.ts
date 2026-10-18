import { once } from "node:events";
import { WebSocket } from "ws";
import { onTestFinished } from "vitest";
import { createRelayServer } from "../src/http";
import { readConfig } from "../src/config";
import { createLog } from "../src/log";
import { rawBytes } from "../src/collab/connection";
import { RELAY_SUBPROTOCOL } from "../../../src/collab/transport/relayProtocol";
import type { Clock } from "../../../src/collab/clock";

export { WebSocket, rawBytes };
export async function startServer(env: Record<string, string> = {}, clock?: Clock) {
  const logs: string[] = [];
  const config = readConfig({ LD_HOST: "127.0.0.1", LD_PORT: "0", ...env });
  const relay = createRelayServer({ config, clock, log: createLog((line) => logs.push(line)) });
  const origin = await relay.listen();
  onTestFinished(() => relay.close());
  return { ...relay, config, origin, url: `${origin.replace("http:", "ws:")}${config.base}collab/v1`, logs };
}
export type TestServer = Awaited<ReturnType<typeof startServer>>;
let nextConnection = 0;

export async function rejectUpgrade(
  server: TestServer,
  options: { origin?: string; headers?: Record<string, string> } = {},
) {
  const socket = new WebSocket(server.url, RELAY_SUBPROTOCOL, { origin: server.origin, ...options });
  socket.on("error", () => {});
  onTestFinished(() => socket.terminate());
  return new Promise<number>((resolve, reject) => {
    socket.once("unexpected-response", (_req, res) => {
      res.resume();
      socket.terminate();
      resolve(res.statusCode ?? 0);
    });
    socket.once("open", () => {
      socket.terminate();
      reject(new Error("Refused request was upgraded"));
    });
    socket.once("error", reject);
  });
}
export async function connect(
  server: TestServer,
  origin = server.origin,
  room?: string,
  headers: Record<string, string> = {},
  options: { autoPong?: boolean } = {},
) {
  const connection = String(++nextConnection);
  const socket = new WebSocket(server.url, RELAY_SUBPROTOCOL, {
    origin,
    headers: { "X-Test-Connection": connection, ...headers },
    ...options,
  });
  const messages: { binary: boolean; bytes: Uint8Array }[] = [];
  socket.on("message", (raw, binary) => messages.push({ binary, bytes: rawBytes(raw).slice() }));
  let serverClosed: Promise<unknown> | undefined;
  const observe = (ws: WebSocket, req: { headers: Record<string, unknown> }) => {
    if (req.headers["x-test-connection"] !== connection) return;
    server.wss.off("connection", observe);
    serverClosed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  };
  server.wss.on("connection", observe);
  const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code))).then(async (code) => {
    await serverClosed;
    server.wss.off("connection", observe);
    return code;
  });
  onTestFinished(() => socket.terminate());
  await once(socket, "open");
  if (room) socket.send(JSON.stringify({ t: "hello", v: 1, room }));
  return { socket, messages, closed };
}

/** A round trip on the same stream orders all earlier messages without wall-clock waits. */
export async function barrier(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CONNECTING) await once(socket, "open");
  if (socket.readyState === WebSocket.CLOSING) {
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("pong", done);
      socket.off("close", done);
      socket.off("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = (e: Error) => {
      cleanup();
      reject(e);
    };
    socket.once("pong", done);
    socket.once("close", done);
    socket.once("error", fail);
    socket.ping();
  });
}

export function browserSockets(origin: string, sockets: WebSocket[], onSend?: (data: unknown) => void) {
  class BrowserSocket extends WebSocket {
    constructor(url: string, protocols: string | string[]) {
      super(url, protocols, { origin });
      sockets.push(this);
    }
    override send(data: Parameters<WebSocket["send"]>[0]) {
      onSend?.(data);
      super.send(data);
    }
  }
  return BrowserSocket as unknown as typeof globalThis.WebSocket;
}
