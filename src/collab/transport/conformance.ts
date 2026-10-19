// The transport conformance harness. Test-only (it imports Vitest): never imported by app code.
//
// Any transport a room may use must pass `describeTransportConformance`: the in-memory transport does in CI
// (memory.test.ts); a future WebRTC strategy or an optional relay runs the same suite against its own harness
// (a loopback or a local test network: never public infrastructure in CI). It checks the transport contract
// (./types.ts), then runs real E2E sessions over it under seeded drops, duplicates, reordering, partitions and
// rejoins, and checks every client converges to the same diagram, and that nothing on the wire carries the room
// secret or plaintext.

import { describe, expect, it } from "vitest";
import { structuralText } from "../../model/diagramDiff";
import type { DiagramFile } from "../../model/types";
import { openRoomClient, RoomClient, type RoomClientOptions } from "../client";
import { FakeClock } from "../clock";
import { CollabDoc } from "../doc";
import { COLLAB_LIMITS } from "../limits";
import { newRoom } from "../keys";
import type { RoomLink } from "../link";
import { seededBytes, seededRandom } from "../random";
import type { Faults } from "./memory";
import { FrameTooLargeError, type CollabTransport, type PeerId } from "./types";

export interface ConformanceHarness {
  /** A new end on the harness's network. It may take a settle() to reach its peers (signalling). */
  connect(): CollabTransport;
  /** Delivers everything in flight, awaiting `idle` between rounds. */
  settle(idle?: () => Promise<void>): Promise<void>;
  /** Every frame as it goes on the wire. */
  tap(fn: (bytes: Uint8Array) => void): () => void;
  maxFrameBytes: number;
  /**
   * Seeded fault injection, where the harness can do it (the in-memory network can). A harness without it runs the
   * fault-free convergence and rejoin scenario only; a production transport's harness should add it.
   */
  faults?: {
    set(f: Partial<Faults>): void;
    partition(groups: PeerId[][]): void;
    heal(): void;
  };
}

/** A synthetic diagram whose words appear nowhere else: finding one on the wire means plaintext leaked. */
export const CANARY = "Zephyrquill";
export const canaryDiagram = (): DiagramFile => ({
  format: "diagrams/v1",
  title: `${CANARY} ledger`,
  nodes: [
    { id: "intake", stencil: "generic.service", label: `${CANARY} intake`, x: 0, y: 0 },
    { id: "ledger", stencil: "postgres", label: `${CANARY} ledger`, x: 320, y: 0 },
  ],
  edges: [{ id: "flow", from: "intake", to: "ledger" }],
});

export const roomFor = (seed: number): RoomLink => newRoom(seededBytes(seed * 7919 + 1));

export { RoomClient as TestClient } from "../client";

export function openClient(
  name: string,
  transport: CollabTransport,
  room: RoomLink,
  clock: FakeClock,
  seed: number,
  opts: { initial?: DiagramFile; doc?: CollabDoc; signed?: RoomClientOptions["signed"] } = {},
): Promise<RoomClient> {
  return openRoomClient({
    name,
    transport,
    room: opts.initial ? newRoom(() => room.secret.slice(), room.hostKey) : room,
    clock,
    random: seededBytes(seed),
    clientId: opts.doc ? undefined : seed,
    ...opts,
  });
}

/** A seeded random step: add, rename, move, re-prop, connect, delete, Undo or Redo. */
export function randomStep(c: RoomClient, rnd: () => number): void {
  if (!c.ready) return;
  const d = c.diagram!;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const r = rnd();
  if (r < 0.2 || d.nodes.length < 2) {
    c.edit((x) => ({
      ...x,
      nodes: [
        ...x.nodes,
        { id: c.newId("n"), stencil: "postgres", label: "new", x: Math.round(rnd() * 900), y: Math.round(rnd() * 900) },
      ],
    }));
  } else if (r < 0.35) {
    const id = pick(d.nodes).id;
    c.edit(
      (x) => ({
        ...x,
        nodes: x.nodes.map((n) => (n.id === id ? { ...n, label: `${c.name}${Math.floor(rnd() * 100)}` } : n)),
      }),
      `label:${id}`,
    );
  } else if (r < 0.5) {
    const id = pick(d.nodes).id;
    c.edit((x) => ({
      ...x,
      nodes: x.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(rnd() * 900), y: Math.round(rnd() * 900) } : n)),
    }));
  } else if (r < 0.6) {
    const id = pick(d.nodes).id;
    c.edit((x) => ({
      ...x,
      nodes: x.nodes.map((n) =>
        n.id === id ? { ...n, props: { ...n.props, [`k${Math.floor(rnd() * 4)}`]: Math.floor(rnd() * 50) } } : n,
      ),
    }));
  } else if (r < 0.72) {
    const [a, b] = [pick(d.nodes).id, pick(d.nodes).id];
    if (a !== b) c.edit((x) => ({ ...x, edges: [...x.edges, { id: c.newId("e"), from: a, to: b }] }));
  } else if (r < 0.82) {
    const id = pick(d.nodes).id;
    c.edit((x) => ({
      ...x,
      nodes: x.nodes.filter((n) => n.id !== id),
      edges: x.edges.filter((e) => e.from !== id && e.to !== id),
    }));
  } else if (r < 0.9) c.binding.undo();
  else if (r < 0.95) c.binding.redo();
  else c.edit((x) => ({ ...x, title: `${c.name} title` }));
}

export function describeTransportConformance(name: string, makeHarness: (seed: number) => ConformanceHarness): void {
  describe(`${name}: transport contract`, () => {
    const collect = (t: CollabTransport) => {
      const got: { from: PeerId; bytes: Uint8Array }[] = [];
      const events: string[] = [];
      t.subscribe({
        frame: (from, bytes) => void got.push({ from, bytes }),
        join: (p) => void events.push(`join:${p}`),
        leave: (p) => void events.push(`leave:${p}`),
      });
      return { got, events };
    };

    it("broadcasts to every other peer once, never to itself", async () => {
      const h = makeHarness(1);
      const [a, b, c] = [h.connect(), h.connect(), h.connect()];
      const [ra, rb, rc] = [collect(a), collect(b), collect(c)];
      await h.settle();
      a.send(new Uint8Array([1, 2, 3]));
      await h.settle();
      expect(ra.got).toHaveLength(0);
      for (const r of [rb, rc]) expect(r.got.map((g) => [g.from, [...g.bytes]])).toEqual([[a.self, [1, 2, 3]]]);
    });

    it("sends to one peer only when told to", async () => {
      const h = makeHarness(2);
      const [a, b, c] = [h.connect(), h.connect(), h.connect()];
      const [rb, rc] = [collect(b), collect(c)];
      await h.settle();
      a.send(new Uint8Array([9]), c.self);
      await h.settle();
      expect(rb.got).toHaveLength(0);
      expect(rc.got).toHaveLength(1);
    });

    it("copies frames: the sender changing its buffer afterwards changes nothing delivered", async () => {
      const h = makeHarness(3);
      const [a, b] = [h.connect(), h.connect()];
      const rb = collect(b);
      await h.settle();
      const buf = new Uint8Array([1, 1, 1]);
      a.send(buf);
      buf.fill(7);
      await h.settle();
      expect([...rb.got[0].bytes]).toEqual([1, 1, 1]);
    });

    it("announces joins and leaves, and a closed end neither sends nor receives", async () => {
      const h = makeHarness(4);
      const a = h.connect();
      const ra = collect(a);
      const b = h.connect();
      const rb = collect(b);
      await h.settle();
      expect(ra.events).toEqual([`join:${b.self}`]);
      expect(rb.events).toEqual([`join:${a.self}`]);
      expect(a.peers()).toEqual([b.self]);
      b.close();
      await h.settle();
      expect(ra.events).toEqual([`join:${b.self}`, `leave:${b.self}`]);
      b.send(new Uint8Array([1]));
      a.send(new Uint8Array([2]));
      await h.settle();
      expect(ra.got).toHaveLength(0);
      expect(rb.got).toHaveLength(0);
      expect(a.peers()).toEqual([]);
    });

    it("refuses a frame larger than it carries", async () => {
      const h = makeHarness(5);
      const a = h.connect();
      h.connect();
      await h.settle();
      expect(() => a.send(new Uint8Array(h.maxFrameBytes + 1))).toThrow(FrameTooLargeError);
    });

    it("carries a room's largest document frame, intact", async () => {
      const h = makeHarness(6);
      expect(h.maxFrameBytes).toBeGreaterThanOrEqual(COLLAB_LIMITS.maxDocFrameBytes);
      const [a, b] = [h.connect(), h.connect()];
      const rb = collect(b);
      await h.settle();
      const big = seededBytes(6)(COLLAB_LIMITS.maxDocFrameBytes);
      a.send(big);
      await h.settle();
      expect(rb.got).toHaveLength(1);
      expect(rb.got[0].bytes.length).toBe(big.length);
      expect(containsBytes(rb.got[0].bytes.subarray(0, 64), big.subarray(0, 64))).toBe(true);
      expect(rb.got[0].bytes.every((v, i) => v === big[i])).toBe(true);
    });
  });

  describe(`${name}: encrypted sessions converge under faults`, () => {
    const SEEDS = Array.from({ length: 8 }, (_, i) => i + 1);
    const scenario = makeHarness(0).faults
      ? "drops, duplicates, reordering, partitions and a rejoin"
      : "a rejoin (no fault injection)";

    it.each(SEEDS)(`three clients, ${scenario} (seed %i)`, async (seed) => {
      const h = makeHarness(seed);
      const clock = new FakeClock();
      const room = roomFor(seed);
      const rnd = seededRandom(seed * 31 + 7);
      const wire: Uint8Array[] = [];
      h.tap((bytes) => void wire.push(bytes));
      const a = await openClient("a", h.connect(), room, clock, seed * 10 + 1, { initial: canaryDiagram() });
      const b = await openClient("b", h.connect(), room, clock, seed * 10 + 2);
      let c = await openClient("c", h.connect(), room, clock, seed * 10 + 3);
      const clients = () => [a, b, c];
      const settle = () => h.settle(async () => void (await Promise.all(clients().map((x) => x.session.idle()))));
      await settle();
      expect(b.ready && c.ready).toBe(true);

      h.faults?.set({ drop: 0.2, duplicate: 0.2, reorder: true });
      for (let round = 0; round < 30; round++) {
        if (round === 8)
          h.faults?.partition([[a.session.transport.self], [b.session.transport.self, c.session.transport.self]]);
        if (round === 16) h.faults?.heal();
        if (round === 20) {
          // c leaves and rejoins with its local copy: a new session (new sender id, new keys' counters).
          const doc = c.session.doc;
          const diagram = c.diagram;
          await c.session.leave();
          c = await openClient("c", h.connect(), room, clock, seed * 10 + 4, { doc });
          c.diagram = diagram;
        }
        for (const x of clients()) if (rnd() < 0.7) randomStep(x, rnd);
        clock.advance(1_000);
        await settle();
      }
      h.faults?.set({ drop: 0, duplicate: 0, reorder: false });
      h.faults?.heal();
      clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await settle();
      clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await settle();

      const states = clients().map((x) => x.projection());
      expect(states[1]).toBe(states[0]);
      expect(states[2]).toBe(states[0]);
      // Each editor shows its room's projection.
      for (const x of clients())
        expect(structuralText(x.diagram)).toBe(structuralText(x.session.doc.project().diagram));
      // No honest frame was refused for anything but replays of duplicates.
      for (const x of clients())
        for (const reason of Object.keys(x.session.stats.rejected)) expect(["replay"]).toContain(reason);
      // Nothing on the wire carries the secret or plaintext.
      const secretHex = Array.from(room.secret, (v) => v.toString(16).padStart(2, "0")).join("");
      for (const bytes of wire) {
        const text = new TextDecoder("latin1").decode(bytes);
        expect(text).not.toContain(CANARY);
        expect(text).not.toContain(secretHex);
        expect(containsBytes(bytes, room.secret)).toBe(false);
      }
    });
  });
}

export function containsBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
