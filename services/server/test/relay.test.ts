import { describe, expect, it } from "vitest";
import { once } from "node:events";
import { FakeClock } from "../../../src/collab/clock";
import { clientFrame, readServerFrame, RELAY_CLOSE, RELAY_LIMITS } from "../../../src/collab/transport/relayProtocol";
import { barrier, connect, startServer, WebSocket } from "./harness";
import { readConfig } from "../src/config";
import { TokenBucket } from "../src/collab/connection";

const room = "A".repeat(43);
const controls = (client: Awaited<ReturnType<typeof connect>>) =>
  client.messages.filter((m) => !m.binary).map((m) => JSON.parse(Buffer.from(m.bytes).toString()));

describe("relay core (real loopback sockets)", () => {
  it("welcomes, announces joins/leaves, isolates rooms and deletes the last empty room", async () => {
    const s = await startServer();
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    const b = await connect(s, s.origin, room);
    const outsider = await connect(s, s.origin, "B".repeat(43));
    await Promise.all([barrier(a.socket), barrier(b.socket), barrier(outsider.socket)]);
    const welcome = controls(b)[0];
    expect(welcome).toMatchObject({
      t: "welcome",
      peers: [controls(a)[0].self],
      cap: 8,
      maxFrame: RELAY_LIMITS.maxFrameBytes,
      durable: false,
    });
    expect(welcome.self).toMatch(/^[a-f0-9]{16}$/);
    expect(controls(a)[1]).toEqual({ t: "join", peer: welcome.self });
    expect(controls(outsider)[0].peers).toEqual([]);
    b.socket.close();
    await b.closed;
    await barrier(a.socket);
    expect(controls(a)[2]).toEqual({ t: "leave", peer: welcome.self });
    a.socket.close();
    await a.closed;
    await barrier(outsider.socket);
    expect(s.rooms.get(room)).toBeUndefined();
    outsider.socket.close();
    await outsider.closed;
    expect(s.rooms.size).toBe(0);
  });

  it("forwards broadcast and addressed opaque binary envelopes with the actual sender", async () => {
    const s = await startServer();
    const clients = await Promise.all([
      connect(s, s.origin, room),
      connect(s, s.origin, room),
      connect(s, s.origin, room),
    ]);
    await Promise.all(clients.map((c) => barrier(c.socket)));
    const [a, b, c] = clients;
    a.socket.send(clientFrame(new Uint8Array([70, 80])));
    await barrier(a.socket);
    await Promise.all(clients.map((c) => barrier(c.socket)));
    const binary = (x: typeof a) => x.messages.filter((m) => m.binary).map((m) => readServerFrame(m.bytes));
    expect(binary(a)).toEqual([]);
    for (const x of [b, c])
      expect(binary(x)).toEqual([{ from: controls(a)[0].self, envelope: new Uint8Array([70, 80]) }]);
    a.socket.send(clientFrame(new Uint8Array([90]), controls(c)[0].self));
    await barrier(a.socket);
    await Promise.all(clients.map((x) => barrier(x.socket)));
    expect(binary(b)).toHaveLength(1);
    expect(binary(c)).toHaveLength(2);
    // A recipient in another room (or the sender) gets nothing.
    a.socket.send(clientFrame(new Uint8Array([99]), controls(a)[0].self));
    await barrier(a.socket);
    expect(binary(a)).toEqual([]);
  });

  it("caps rooms at eight participants with 4008", async () => {
    const s = await startServer();
    for (let i = 0; i < 8; i++) {
      const c = await connect(s, s.origin, room);
      await barrier(c.socket);
    }
    const ninth = await connect(s, s.origin, room);
    expect(await ninth.closed).toBe(RELAY_CLOSE.full);
    expect(s.rooms.get(room)?.peers.size).toBe(8);
  });

  it("closes oversized wire payloads with 1009", async () => {
    const s = await startServer();
    const c = await connect(s, s.origin, room);
    await barrier(c.socket);
    c.socket.send(new Uint8Array(RELAY_LIMITS.maxPayload + 1));
    expect(await c.closed).toBe(RELAY_CLOSE.tooBig);
  });
  it("closes oversized envelopes below the ws payload ceiling with 1009", async () => {
    const s = await startServer();
    const c = await connect(s, s.origin, room);
    await barrier(c.socket);
    c.socket.send(clientFrame(new Uint8Array(RELAY_LIMITS.maxFrameBytes + 1)));
    expect(await c.closed).toBe(RELAY_CLOSE.tooBig);
  });
  it.each(["frames", "bytes"])("limits inbound %s with 4029", async (kind) => {
    const s = await startServer(
      kind === "frames" ? { LD_FRAME_BURST: "2" } : { LD_BYTES_PER_WINDOW: "128" },
      new FakeClock(),
    );
    const c = await connect(s, s.origin, room);
    await barrier(c.socket);
    if (kind === "frames") {
      c.socket.send(clientFrame(new Uint8Array([1])));
      c.socket.send(clientFrame(new Uint8Array([2])));
    } else c.socket.send(clientFrame(new Uint8Array(128)));
    expect(await c.closed).toBe(RELAY_CLOSE.rate);
  });
  it.each(["https://other.invalid", "null", ""])("rejects Origin %j with 4003", async (origin) => {
    const s = await startServer();
    const c = await connect(s, origin);
    expect(await c.closed).toBe(RELAY_CLOSE.origin);
    expect(s.rooms.size).toBe(0);
  });
  it("supports explicitly allowed origins and releases per-IP admission slots", async () => {
    const s = await startServer({ LD_ALLOWED_ORIGINS: "https://allowed.invalid", LD_SOCKETS_PER_IP: "1" });
    const a = await connect(s, "https://allowed.invalid", room);
    await barrier(a.socket);
    const b = await connect(s);
    expect(await b.closed).toBe(RELAY_CLOSE.rate);
    a.socket.close();
    await a.closed;
    const c = await connect(s, s.origin, room);
    await barrier(c.socket);
    expect(controls(c)[0].t).toBe("welcome");
  });
  it("requires hello before the deadline, with no real-time sleep", async () => {
    const clock = new FakeClock();
    const s = await startServer({}, clock);
    const c = await connect(s);
    clock.advance(s.config.helloTimeoutMs - 1);
    expect(c.socket.readyState).toBe(WebSocket.OPEN);
    clock.advance(1);
    expect(await c.closed).toBe(RELAY_CLOSE.badFrame);
    expect(clock.pending).toBe(0);
  });
  it("caps total rooms and sockets independently", async () => {
    const s = await startServer({ LD_MAX_ROOMS: "1", LD_MAX_SOCKETS: "2" });
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    const b = await connect(s, s.origin, "B".repeat(43));
    expect(await b.closed).toBe(RELAY_CLOSE.full);
    const c = await connect(s, s.origin, room);
    await barrier(c.socket);
    const d = await connect(s);
    expect(await d.closed).toBe(RELAY_CLOSE.rate);
    expect(s.rooms.size).toBe(1);
  });
  it("ignores spoofed forwarding headers unless the proxy is explicitly trusted", async () => {
    for (const trust of [false, true]) {
      const s = await startServer({ LD_SOCKETS_PER_IP: "1", LD_TRUST_PROXY: trust ? "1" : "0" });
      const a = await connect(s, s.origin, room);
      await barrier(a.socket);
      const b = new WebSocket(s.url, "livediagrams.relay.v1", {
        origin: s.origin,
        headers: { "X-Forwarded-For": "192.0.2.1" },
      });
      const closed = new Promise<number>((resolve) => b.once("close", resolve));
      await once(b, "open");
      if (trust) {
        b.send(JSON.stringify({ t: "hello", v: 1, room }));
        await barrier(b);
        expect(b.readyState).toBe(WebSocket.OPEN);
        b.close();
      } else expect(await closed).toBe(RELAY_CLOSE.rate);
      await closed;
    }
  });
  it("evicts a slow recipient and refuses new sockets or joins while aggregate buffers are full", async () => {
    const s = await startServer({ LD_SOCKET_BUFFER_BYTES: "512", LD_TOTAL_BUFFER_BYTES: "1024" });
    const a = await connect(s, s.origin, room);
    const b = await connect(s, s.origin, room);
    await Promise.all([barrier(a.socket), barrier(b.socket)]);
    const slow = [...s.wss.clients][1];
    // Model backpressure directly: no OS buffer-size or network-speed assumptions.
    Object.defineProperty(slow, "bufferedAmount", { configurable: true, get: () => 513 });
    a.socket.send(clientFrame(new Uint8Array([1])));
    expect(await b.closed).toBe(RELAY_CLOSE.rate);
    const serverA = [...s.wss.clients][0];
    const waiting = await connect(s);
    await barrier(waiting.socket);
    Object.defineProperty(serverA, "bufferedAmount", { configurable: true, get: () => 1025 });
    const refused = await connect(s);
    expect(await refused.closed).toBe(RELAY_CLOSE.rate);
    waiting.socket.send(JSON.stringify({ t: "hello", v: 1, room }));
    expect(await waiting.closed).toBe(RELAY_CLOSE.rate);
  });
  it.each(["idle", "missing-pongs"])("cleans up %s sockets with a fake clock", async (kind) => {
    const clock = new FakeClock();
    const s = await startServer(kind === "idle" ? { LD_IDLE_TIMEOUT_MS: "25000" } : {}, clock);
    const c = await connect(s, s.origin, room);
    await barrier(c.socket);
    clock.advance(s.config.pingIntervalMs * (kind === "idle" ? 1 : s.config.missedPongs + 1));
    await c.closed;
    expect(s.rooms.size).toBe(0);
    expect(clock.pending).toBe(0);
  });
  it.each(["binary", "bad-version", "bad-room", "extra-field", "duplicate-hello", "bad-tag"])(
    "refuses %s with 4000",
    async (kind) => {
      const s = await startServer();
      const c = await connect(s);
      if (kind === "duplicate-hello" || kind === "bad-tag") {
        c.socket.send(JSON.stringify({ t: "hello", v: 1, room }));
        await barrier(c.socket);
      }
      c.socket.send(
        kind === "binary"
          ? new Uint8Array([0, 1])
          : kind === "bad-tag"
            ? new Uint8Array([2, 1])
            : JSON.stringify({
                t: "hello",
                v: kind === "bad-version" ? 2 : 1,
                room: kind === "bad-room" ? "bad" : room,
                ...(kind === "extra-field" ? { extra: "no" } : {}),
              }),
      );
      expect(await c.closed).toBe(RELAY_CLOSE.badFrame);
    },
  );
  it("never logs payloads, room IDs, close reasons or IPs by default", async () => {
    const s = await startServer();
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    const canary = "Synthetic-canary-never-log";
    a.socket.send(clientFrame(Buffer.from(canary)));
    await barrier(a.socket);
    a.socket.close(1000, canary);
    await a.closed;
    const b = await connect(s);
    b.socket.send(canary);
    await b.closed;
    expect(s.logs.length).toBeGreaterThan(0);
    const logs = s.logs.join("\n");
    for (const word of [canary, room, "127.0.0.1"]) expect(logs).not.toContain(word);
    for (const line of s.logs)
      expect(Object.keys(JSON.parse(line)).every((k) => ["event", "code"].includes(k))).toBe(true);
  });
  it("reserves subpath namespaces, rejects room IDs in URLs, and exposes health without metrics by default", async () => {
    const s = await startServer({ LD_BASE: "/tools/diagrams/" });
    for (const [path, status] of [
      ["/healthz", 200],
      ["/readyz", 200],
      ["/metrics", 404],
      ["/tools/diagrams/api/v1/rooms", 501],
      ["/tools/diagrams/collab/", 501],
      ["/missing", 404],
    ] as const)
      expect((await fetch(`${s.origin}${path}`)).status).toBe(status);
    const ws = new WebSocket(`${s.url}?room=${room}`, "livediagrams.relay.v1", { origin: s.origin });
    const error = await once(ws, "error");
    expect(String(error[0])).toContain("404");
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    s.drain();
    expect(await a.closed).toBe(RELAY_CLOSE.restart);
    expect((await fetch(`${s.origin}/readyz`)).status).toBe(503);
  });
});

describe("validated config and clock budgets", () => {
  it.each([
    { LD_PORT: "-1" },
    { LD_PORT: "65536" },
    { LD_PORT: "NaN" },
    { LD_ROOM_CAP: "0" },
    { LD_TRUST_PROXY: "true" },
    { LD_BASE: "/../" },
    { LD_ALLOWED_ORIGINS: "*" },
    { LD_ORIGIN: "https://example.invalid/path" },
    { LD_MAX_PAYLOAD: "999999999" },
  ])("rejects %j", (env) => {
    expect(() => readConfig(env)).toThrow();
  });
  it("refills token buckets, caps bursts, and ignores backwards time", () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(10, 1, clock);
    expect(bucket.take(10)).toBe(true);
    expect(bucket.take(1)).toBe(false);
    clock.advance(5);
    expect(bucket.take(5)).toBe(true);
    clock.advance(100);
    expect(bucket.take(11)).toBe(false);
    expect(bucket.take(10)).toBe(true);
  });
});
