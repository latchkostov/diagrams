import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { WebSocket } from "../../../services/server/test/harness";
import { barrier, browserSockets, rawBytes } from "../../../services/server/test/harness";
import { createRelayServer } from "../../../services/server/src/http";
import { readConfig } from "../../../services/server/src/config";
import { createLog } from "../../../services/server/src/log";
import { FakeClock } from "../clock";
import { deriveRoomKeys } from "../keys";
import { seededBytes } from "../random";
import { describeTransportConformance, roomFor } from "./conformance";
import { createRelayTransport } from "./relay";
import { RELAY_LIMITS, parseHello, readClientFrame, RELAY_CLOSE } from "./relayProtocol";
import type { CollabTransport } from "./types";

const relay = createRelayServer({
  config: readConfig({ LD_HOST: "127.0.0.1", LD_PORT: "0" }),
  log: createLog(() => {}),
});
let origin: string;
const sockets: WebSocket[] = [];
const transports: CollabTransport[] = [];
const ids = await Promise.all(
  Array.from({ length: 9 }, (_, seed) => deriveRoomKeys(roomFor(seed)).then((k) => k.roomId)),
);
beforeAll(async () => {
  origin = await relay.listen();
});
afterEach(async () => {
  for (const t of transports.splice(0)) t.close();
  await Promise.all(sockets.splice(0).map(barrier));
});
afterAll(() => relay.close());

describeTransportConformance("WebSocket relay (real server)", (seed) => {
  const taps = new Set<(bytes: Uint8Array) => void>();
  let activity = 0;
  let observing = false;
  return {
    connect() {
      if (!observing) {
        observing = true;
        const observe = (ws: WebSocket, req: { url?: string }) => {
          expect(req.url).toBe("/collab/v1");
          ws.on("message", (raw, binary) => {
            activity++;
            const bytes = rawBytes(raw);
            if (binary) {
              if (taps.size) {
                const envelope = readClientFrame(bytes)?.envelope;
                expect(envelope?.length).toBeGreaterThanOrEqual(48);
                expect([...envelope!.subarray(0, 3)]).toEqual([0x4c, 0x44, 1]);
              }
              for (const tap of taps) tap(bytes);
            } else {
              const hello = parseHello(Buffer.from(bytes).toString());
              expect(hello).toEqual({ t: "hello", v: 1, room: ids[seed] });
              expect(hello?.room).toHaveLength(43);
            }
          });
        };
        relay.wss.on("connection", observe);
        onTestFinished(() => {
          relay.wss.off("connection", observe);
        });
      }
      const t = createRelayTransport({
        url: `${origin.replace("http:", "ws:")}/collab/v1`,
        roomId: ids[seed],
        WebSocket: browserSockets(origin, sockets),
        random: seededBytes(seed + transports.length),
      });
      transports.push(t);
      return t;
    },
    async settle(idle) {
      // Ping/pong barriers plus awaited session queues drain network and WebCrypto work in both directions.
      let quiet = 0;
      for (let round = 0; round < 24; round++) {
        const before = activity;
        await Promise.all(sockets.map(barrier));
        await idle?.();
        await Promise.all(sockets.map(barrier));
        await idle?.();
        if (activity === before) quiet++;
        else quiet = 0;
        if (quiet >= 3) return;
      }
      throw new Error("Relay did not settle in 24 ordered round trips");
    },
    tap(fn) {
      taps.add(fn);
      return () => {
        taps.delete(fn);
      };
    },
    maxFrameBytes: RELAY_LIMITS.maxFrameBytes,
  };
});

describe("relay reconnect and lifecycle", () => {
  it("can close while connecting without retaining timers or delivering events", async () => {
    const clock = new FakeClock();
    const t = createRelayTransport({
      url: `${origin.replace("http:", "ws:")}/collab/v1`,
      roomId: ids[0],
      WebSocket: browserSockets(origin, sockets),
      clock,
    });
    transports.push(t);
    const events: string[] = [];
    t.subscribe({
      join: (p) => {
        events.push(p);
      },
      leave() {},
      frame() {},
    });
    t.close();
    t.close();
    t.retry?.();
    await barrier(sockets.at(-1)!);
    expect(clock.pending).toBe(0);
    expect(events).toEqual([]);
  });
  it("reports a full room without retry loops, and an explicit retry can join after a departure", async () => {
    const make = (clock = new FakeClock()) => {
      const t = createRelayTransport({
        url: `${origin.replace("http:", "ws:")}/collab/v1`,
        roomId: ids[8],
        WebSocket: browserSockets(origin, sockets),
        clock,
      });
      transports.push(t);
      return t;
    };
    const occupants: CollabTransport[] = [];
    for (let i = 0; i < 8; i++) {
      occupants.push(make());
      await barrier(sockets.at(-1)!);
    }
    const clock = new FakeClock();
    const ninth = make(clock);
    await barrier(sockets.at(-1)!);
    expect(ninth.connectivity?.()).toBe("room-full");
    expect(clock.pending).toBe(0);
    occupants[0].close();
    await Promise.all(sockets.map(barrier));
    ninth.retry?.();
    await barrier(sockets.at(-1)!);
    expect(ninth.connectivity?.()).toBe("connected");
    expect(ninth.peers()).toHaveLength(7);
  });
  it("preserves per-peer async delivery order and drops deliveries after unsubscribe", async () => {
    const make = () => {
      const t = createRelayTransport({
        url: `${origin.replace("http:", "ws:")}/collab/v1`,
        roomId: ids[0],
        WebSocket: browserSockets(origin, sockets),
      });
      transports.push(t);
      return t;
    };
    const a = make(),
      b = make();
    await Promise.all(sockets.map(barrier));
    const got: number[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    onTestFinished(() => release());
    const unsubscribe = b.subscribe({
      join() {},
      leave() {},
      async frame(_from, bytes) {
        got.push(bytes[0]);
        if (bytes[0] === 1) {
          entered();
          await held;
        }
      },
    });
    a.send(new Uint8Array([1]));
    a.send(new Uint8Array([2]));
    await started;
    await Promise.all(sockets.map(barrier));
    expect(got).toEqual([1]);
    unsubscribe();
    release();
    await Promise.all(sockets.map(barrier));
    expect(got).toEqual([1]);
  });
  it("reconnects with a new peer ID, clears old peers and cancels timers on close", async () => {
    const clock = new FakeClock();
    const t = createRelayTransport({
      url: `${origin.replace("http:", "ws:")}/collab/v1`,
      roomId: ids[0],
      WebSocket: browserSockets(origin, sockets),
      clock,
      random: seededBytes(1),
    });
    transports.push(t);
    await barrier(sockets.at(-1)!);
    const old = t.self;
    expect(old).toMatch(/^[a-f0-9]{16}$/);
    const socket = [...relay.wss.clients][0];
    const closed = new Promise<void>((resolve) => sockets.at(-1)!.once("close", () => resolve()));
    socket.close(RELAY_CLOSE.restart);
    await closed;
    expect(t.connectivity?.()).toBe("server-unreachable");
    expect(t.peers()).toEqual([]);
    clock.advance(clock.nextDue()! - clock.now());
    await barrier(sockets.at(-1)!);
    expect(t.self).not.toBe(old);
    expect(t.connectivity?.()).toBe("connected");
    t.close();
    expect(clock.pending).toBe(0);
  });
  it("rejects invalid room IDs and credential-bearing URLs before opening a socket", () => {
    expect(() => createRelayTransport({ url: "ws://localhost/collab/v1", roomId: "bad" })).toThrow();
    expect(() => createRelayTransport({ url: "ws://localhost/collab/v1?room=secret", roomId: ids[0] })).toThrow();
  });
});
