import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { FakeClock } from "./clock";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import { newAgreement, newIdentity } from "./signing";
import { commitEpoch, signStart } from "./epochs";
import { deriveRoomKeys, newEpochSecret } from "./keys";
import { seededBytes } from "./random";
import { DOC } from "./protocol";
import { CollabSession } from "./session";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { MemoryNetwork, type Faults } from "./transport/memory";
import type { CollabTransport } from "./transport/types";

// A joiner in a signed room (v2), or let in to a knock-to-join room (v3), always ends up with the document (the same
// as the host's) while the host is reachable, whatever the network does to the order and timing of what the host
// sends: its presence (the binding every other frame is checked against) or its lobby hellos late, lost or after its
// sync replies; frames lost, duplicated or reordered; a document large enough to travel in fragments; let in late, or
// just before a re-key.

const PRESENCE = 2;
const LOBBY = 4;

/** A diagram large enough that a whole sync reply travels in fragments (past COLLAB_LIMITS.maxFragmentBytes). */
function largeDiagram(): DiagramFile {
  const base = canaryDiagram();
  const nodes = Array.from({ length: 4_500 }, (_, i) => ({
    id: `bulk${i}`,
    stencil: "postgres",
    label: `${"x".repeat(260)}${i}`,
    x: i,
    y: 0,
  }));
  return { ...base, nodes: [...base.nodes, ...nodes] } as DiagramFile;
}

/** `transport`'s frames go through `filter` first: false drops one. */
function intercept(transport: CollabTransport, filter: (bytes: Uint8Array, to?: string) => boolean): void {
  const send = transport.send.bind(transport);
  transport.send = (bytes, to) => {
    if (filter(bytes, to)) send(bytes, to);
  };
}

async function join(opts: {
  seed: number;
  faults?: Partial<Faults>;
  diagram?: DiagramFile;
  /** What the host's transport does to its frames, once the joiner is there. */
  hostFilter?: (joiner: string) => (bytes: Uint8Array, to?: string) => boolean;
  /** What the joiner's transport does to its frames. */
  joinerFilter?: (bytes: Uint8Array, to?: string) => boolean;
  rounds?: number;
  /** Seen while it waited: the joiner's reasons. */
  waits?: string[];
  snapshots?: ReturnType<CollabSession["diagnostics"]>[];
  /**
   * A knock-to-join room (v3): the joiner knocks, and the host lets them in once the knock is here and `admitAfter`
   * rounds have passed; with `rekey`, the host removes someone else straight after.
   */
  knock?: { admitAfter?: number; rekey?: boolean };
}): Promise<{ host: TestClient; joiner: TestClient }> {
  const net = new MemoryNetwork({ seed: opts.seed });
  const clock = new FakeClock();
  const hostId = await newIdentity();
  const link: RoomLink = {
    ...roomFor(opts.seed),
    hostKey: hostId.key,
    ...(opts.knock ? { knock: true as const } : {}),
  };
  const clients: TestClient[] = [];
  const settle = () => net.settle(async () => void (await Promise.all(clients.map((c) => c.session.idle()))));
  const hostTransport = net.connect();
  let hostKnock;
  if (opts.knock) {
    const lobby = await deriveRoomKeys(link);
    const agreement = await newAgreement();
    const secret = newEpochSecret(seededBytes(opts.seed + 500));
    const start = await signStart(hostId, lobby.roomId, {
      epoch: 0,
      kc: await commitEpoch(secret, lobby.roomId, 0),
      x: agreement.x,
    });
    hostKnock = { agreement, chain: { starts: [start], logs: [] }, secret };
  }
  const host = await openClient("host", hostTransport, link, clock, opts.seed * 10 + 1, {
    initial: opts.diagram ?? canaryDiagram(),
    signed: { identity: hostId, ...(hostKnock ? { knock: hostKnock } : {}) },
  });
  clients.push(host);
  onTestFinished(() => host.session.leave());
  await settle();
  // Someone else in the room, to remove (a re-key) just after the joiner is let in.
  let third: TestClient | undefined;
  if (opts.knock?.rekey) {
    const thirdId = await newIdentity();
    third = await openClient("third", net.connect(), link, clock, opts.seed * 10 + 3, {
      signed: { identity: thirdId, knock: { agreement: await newAgreement(), chain: { starts: [], logs: [] } } },
    });
    clients.push(third);
    onTestFinished(() => third!.session.leave());
    await settle();
    expect(await host.session.admit(thirdId.key)).toBe(true);
    await settle();
  }
  const joinerTransport = net.connect();
  if (opts.hostFilter) intercept(hostTransport, opts.hostFilter(joinerTransport.self));
  if (opts.joinerFilter) intercept(joinerTransport, opts.joinerFilter);
  if (opts.faults) net.setFaults(opts.faults);
  const joinerId = await newIdentity();
  const joiner = await openClient("joiner", joinerTransport, link, clock, opts.seed * 10 + 2, {
    signed: {
      identity: joinerId,
      ...(opts.knock ? { knock: { agreement: await newAgreement(), chain: { starts: [], logs: [] } } } : {}),
    },
  });
  clients.push(joiner);
  if (opts.snapshots) {
    opts.snapshots.push(joiner.session.diagnostics());
    onTestFinished(joiner.session.onChange(() => opts.snapshots!.push(joiner.session.diagnostics())));
  }
  onTestFinished(() => joiner.session.leave());
  let admitted = !opts.knock;
  const converged = () => joiner.session.hasDocument && joiner.projection() === host.projection();
  for (let i = 0; i < (opts.rounds ?? 16) && !converged(); i++) {
    await settle();
    opts.waits?.push(joiner.session.waiting ?? "none");
    if (!admitted && i >= (opts.knock?.admitAfter ?? 0) && host.session.knocks.has(joinerId.key)) {
      admitted = await host.session.admit(joinerId.key);
      if (third) expect(await host.session.remove(third.session.signed!.key)).toBe(true);
    }
    clock.advance(COLLAB_LIMITS.antiEntropyMs);
  }
  await settle();
  return { host, joiner };
}

/** The joiner has the document, the same as the host's (full convergence, not just something). */
function expectConverged({ host, joiner }: { host: TestClient; joiner: TestClient }): void {
  expect(joiner.session.hasDocument, why(joiner)).toBe(true);
  expect(joiner.projection()).toBe(host.projection());
  expect(joiner.diagram).toEqual(host.diagram);
}

const why = (c: TestClient) => JSON.stringify(c.session.stats.rejected);

describe("a joiner always gets the document from a reachable host", () => {
  it("baseline", async () => {
    const joined = await join({ seed: 1 });
    expectConverged(joined);
  });

  it("the host's first presence is lost", async () => {
    let dropped = 0;
    const joined = await join({
      seed: 2,
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && dropped++ < 1),
    });
    expectConverged(joined);
  });

  it("the host's presence is lost for a long while (its sync replies arrive meanwhile)", async () => {
    let lost = 0;
    const joined = await join({
      seed: 3,
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 5),
      rounds: 30,
    });
    expectConverged(joined);
  });

  it("a large (fragmented) document while the host's presence is late", async () => {
    let lost = 0;
    const joined = await join({
      seed: 4,
      diagram: largeDiagram(),
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 2),
      rounds: 30,
    });
    expectConverged(joined);
  }, 120_000);

  it("frames delivered in any order", async () => {
    const joined = await join({ seed: 5, faults: { reorder: true } });
    expectConverged(joined);
  });

  it("some frames lost and some duplicated", async () => {
    const joined = await join({ seed: 6, faults: { drop: 0.15, duplicate: 0.1 }, rounds: 30 });
    expectConverged(joined);
  });

  it("a large document, reordered", async () => {
    const joined = await join({ seed: 7, diagram: largeDiagram(), faults: { reorder: true }, rounds: 30 });
    expectConverged(joined);
  }, 120_000);

  it("the joiner's presence is lost at the host for a long while: the host doesn't hold it against them", async () => {
    let lost = 0;
    const joined = await join({
      seed: 8,
      joinerFilter: (bytes) => !(bytes[3] === PRESENCE && lost++ < 6),
      rounds: 30,
    });
    expectConverged(joined);
    expect(joined.host.session.stats.rejected.quarantined ?? 0, why(joined.host)).toBe(0);
  });

  it("an honest host held too long (its binding lost, its replies piling up) is never quarantined: dropped, asked again", async () => {
    let lost = 0;
    const joined = await join({
      seed: 9,
      diagram: largeDiagram(),
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 6),
      rounds: 40,
    });
    expectConverged(joined);
    expect(joined.joiner.session.stats.rejected.quarantined ?? 0).toBe(0);
    expect(joined.joiner.session.stats.rejected["held-dropped"] ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it("says why it waits: checking who's here while the host's binding is missing, then nothing once it has the diagram", async () => {
    let lost = 0;
    const waits: string[] = [];
    const snapshots: ReturnType<CollabSession["diagnostics"]>[] = [];
    const joined = await join({
      seed: 10,
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 3),
      waits,
      snapshots,
    });
    expect(snapshots.some((snapshot) => snapshot.waiting === "verifying" && !snapshot.hasDocument)).toBe(true);
    expect(snapshots.at(-1)).toMatchObject({ waiting: "none", hasDocument: true, present: 1 });
    expect(snapshots.every((snapshot) => Object.isFrozen(snapshot) && Object.isFrozen(snapshot.rejected))).toBe(true);
    expect(waits).toContain("verifying");
    expect(joined.joiner.session.waiting).toBeUndefined();
  });

  it("a healthy join asks for the document once: no extra full request when the host's binding arrives", async () => {
    // Every document message a session sends, with the session and its clock's time (the joiner's are picked out
    // once it exists): its sync requests during the handshake, before any periodic anti-entropy.
    const sent: { session: CollabSession; type: number; at: number }[] = [];
    const proto = CollabSession.prototype as unknown as { sendDoc: (message: Uint8Array, to?: string) => void };
    const sendDoc = proto.sendDoc;
    const spy = vi.spyOn(proto, "sendDoc").mockImplementation(function (this: CollabSession, message, to) {
      const at = (this as unknown as { clock: { now(): number } }).clock.now();
      sent.push({ session: this, type: message[0], at });
      return sendDoc.call(this, message, to);
    });
    onTestFinished(() => spy.mockRestore());
    const joined = await join({ seed: 11 });
    expectConverged(joined);
    const mine = sent.filter((m) => m.session === joined.joiner.session);
    const handshake = mine.filter((m) => m.at < mine[0].at + COLLAB_LIMITS.antiEntropyMs);
    expect(handshake.filter((m) => m.type === DOC.syncRequest)).toHaveLength(1);
    // One sync reply's worth, not two: the binding arriving doesn't ask again.
    expect(joined.joiner.session.stats.rejected["held-dropped"] ?? 0).toBe(0);
    expect(joined.joiner.session.diagnostics()).toMatchObject({ waiting: "none", held: 0, behind: 0 });
  });
});

describe("a newcomer let in to a knock-to-join room always gets the document", () => {
  it("baseline", async () => {
    expectConverged(await join({ seed: 21, knock: {} }));
  });

  it("let in late (after half a minute at the door)", async () => {
    const waits: string[] = [];
    const joined = await join({ seed: 22, knock: { admitAfter: 7 }, rounds: 30, waits });
    expectConverged(joined);
    expect(waits).toContain("admission");
  });

  it("let in just before the host removes someone (a re-key while joining)", async () => {
    const joined = await join({ seed: 23, knock: { rekey: true }, rounds: 30 });
    expectConverged(joined);
    expect(joined.joiner.session.keys.epoch).toBe(1);
  });

  it("the host's lobby hellos lost for a while", async () => {
    let lost = 0;
    const joined = await join({
      seed: 24,
      knock: {},
      hostFilter: (to) => (bytes, peer) => !(bytes[3] === LOBBY && (peer === to || peer === undefined) && lost++ < 4),
      rounds: 30,
    });
    expectConverged(joined);
  });

  it("the host's presence lost for a long while after letting them in", async () => {
    let lost = 0;
    const joined = await join({
      seed: 25,
      knock: {},
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 6),
      rounds: 40,
    });
    expectConverged(joined);
    expect(joined.joiner.session.stats.rejected.quarantined ?? 0).toBe(0);
  });

  it("a large (fragmented) document, the host's presence late", async () => {
    let lost = 0;
    const joined = await join({
      seed: 26,
      knock: {},
      diagram: largeDiagram(),
      hostFilter: (to) => (bytes, peer) =>
        !(bytes[3] === PRESENCE && (peer === to || peer === undefined) && lost++ < 3),
      rounds: 40,
    });
    expectConverged(joined);
  }, 120_000);

  it("frames reordered, lost and duplicated", async () => {
    expectConverged(
      await join({ seed: 27, knock: {}, faults: { reorder: true, drop: 0.1, duplicate: 0.1 }, rounds: 40 }),
    );
  });
});

describe("someone whose replies were dropped before they could count", () => {
  it("is asked again once they're known as an editor (their grant came late), and nobody is quarantined", async () => {
    const net = new MemoryNetwork({ seed: 31 });
    const clock = new FakeClock();
    const hostId = await newIdentity();
    const link: RoomLink = { ...roomFor(31), hostKey: hostId.key };
    const clients: TestClient[] = [];
    const settle = () => net.settle(async () => void (await Promise.all(clients.map((c) => c.session.idle()))));
    const host = await openClient("host", net.connect(), link, clock, 311, {
      initial: canaryDiagram(),
      signed: { identity: hostId },
    });
    clients.push(host);
    const editor = await openClient("editor", net.connect(), link, clock, 312, {
      signed: { identity: await newIdentity() },
    });
    clients.push(editor);
    await settle();
    expect(host.session.signed!.isEditor(editor.session.signed!.key)).toBe(true);
    // The host goes: only the editor can serve the newcomer, who doesn't know it's an editor yet (its first roster
    // lost), so the editor's replies wait, then are dropped.
    await host.session.leave();
    clients.splice(0, 1);
    await settle();
    const joiner = await openClient("joiner", net.connect(), link, clock, 313, {
      signed: { identity: await newIdentity() },
    });
    clients.push(joiner);
    onTestFinished(() => joiner.session.leave());
    const signed = joiner.session.signed!;
    const add = signed.addEntries.bind(signed);
    let ignored = 0;
    signed.addEntries = (list, budget) => (ignored++ < 6 ? Promise.resolve(undefined) : add(list, budget));
    for (let i = 0; i < 20 && !joiner.session.hasDocument; i++) {
      await settle();
      clock.advance(COLLAB_LIMITS.antiEntropyMs);
    }
    await settle();
    expect(joiner.session.stats.rejected["held-dropped"] ?? 0).toBeGreaterThan(0);
    expect(joiner.session.stats.rejected.quarantined ?? 0).toBe(0);
    expect(joiner.projection()).toBe(editor.projection());
    expect(joiner.diagram).toEqual(editor.diagram);
  });
});
