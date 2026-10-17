import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as Y from "yjs";
import { textToBytes } from "../interop/codec";
import { FakeClock } from "./clock";
import { commandsFromDiff } from "./commands";
import { HEADER_BYTES, Sealer } from "./envelope";
import { checkCommands } from "./guard";
import { deriveRoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import { DOC, fragment, frame, PRESENCE } from "./protocol";
import { metaOf } from "./schema";
import { refusalMessage } from "./lab/demo";
import { seededBytes } from "./random";
import { CollabSession, CONNECTION_WAIT_MS, PrivateDiagramError } from "./session";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { MemoryNetwork } from "./transport/memory";
import type { CollabTransport } from "./transport/types";

const room = roomFor(1);

it("bounds a never-connecting transport, retries discovery and keeps edits", async () => {
  const clock = new FakeClock(),
    net = new MemoryNetwork();
  const retry = vi.fn();
  const session = await CollabSession.open({
    room,
    clock,
    transport: { ...net.connect(), retry },
    privacy: {},
    initial: canaryDiagram(),
  });
  const changed = vi.fn();
  session.onChange(changed);
  session.doc.apply([{ op: "meta", set: { title: "Keep my local edits" } }]);
  const proof = await session.doc.syncProof();
  clock.advance(CONNECTION_WAIT_MS - 1);
  expect(session.connectionFailed).toBe(false);
  clock.advance(1);
  expect(session.connectionFailed).toBe(true);
  expect(changed).toHaveBeenCalled();
  session.retryConnection();
  expect(retry).toHaveBeenCalledTimes(1);
  expect(session.connectionFailed).toBe(false);
  expect(await session.doc.syncProof()).toEqual(proof);
  clock.advance(CONNECTION_WAIT_MS);
  expect(session.connectionFailed).toBe(true);
  await session.leave();
  expect(session.connectionFailed).toBe(false);
  expect(clock.pending).toBe(0);
  session.doc.destroy();
});

it("bounds authenticated proof floods before computing sync fingerprints", async () => {
  const { a, net, settle } = await room3();
  const evil = await rogue(net);
  onTestFinished(() => evil.transport.close());
  await settle();
  const proof = vi.spyOn(a.session.doc, "syncProof");
  onTestFinished(() => proof.mockRestore());
  for (let i = 0; i < COLLAB_LIMITS.syncProofsPerWindow * 2; i++)
    await evil.send("doc", frame(i % 2 ? DOC.syncProof : DOC.syncAck, new Uint8Array(32)));
  await settle();
  expect(a.session.stats.rejected["proof-throttled"] ?? 0).toBeGreaterThan(0);
  expect(proof.mock.calls.length).toBeLessThanOrEqual(COLLAB_LIMITS.syncProofsPerWindow);
});

async function room3(opts: { seed?: number } = {}) {
  const net = new MemoryNetwork({ seed: opts.seed ?? 1 });
  const clock = new FakeClock();
  const a = await openClient("a", net.connect(), room, clock, 11, { initial: canaryDiagram() });
  const b = await openClient("b", net.connect(), room, clock, 12);
  const c = await openClient("c", net.connect(), room, clock, 13);
  const clients = [a, b, c];
  const settle = () => net.settle(async () => void (await Promise.all(clients.map((x) => x.session.idle()))));
  await settle();
  return { net, clock, a, b, c, clients, settle };
}

/** A raw end on the network that seals whatever it's told to, with the room's keys (a malicious member). */
async function rogue(net: MemoryNetwork, link = room) {
  const t: CollabTransport = net.connect();
  const sealer = new Sealer(await deriveRoomKeys(link), seededBytes(99)(16));
  return {
    transport: t,
    async send(channel: "doc" | "presence", plaintext: Uint8Array) {
      t.send(await sealer.seal(channel, plaintext));
    },
  };
}

/**
 * The size tests run with every byte limit divided by 16 (restored after each): the behaviour at the bounds is the
 * same, and the test moves megabytes instead of tens of them, so it doesn't crowd the rest of the suite.
 */
const SCALE = 16;
const BYTE_LIMITS = [
  "maxFragmentBytes",
  "maxDocFrameBytes",
  "maxMessageBytes",
  "maxStepBytes",
  "maxRoomBytes",
  "maxHistoryBytes",
  "maxPartialBytesPerSender",
  "maxPartialBytes",
  "senderBytesPerWindow",
  "replyBytesPerWindow",
  "maxQueuedBytes",
  "maxQueuedBytesPerPeer",
] as const;
function scaledLimits() {
  const limits = COLLAB_LIMITS as unknown as Record<string, number>;
  const saved = Object.fromEntries(BYTE_LIMITS.map((k) => [k, limits[k]]));
  for (const k of BYTE_LIMITS) limits[k] = Math.floor(limits[k] / SCALE);
  onTestFinished(() => void Object.assign(limits, saved));
}
/** Characters (three UTF-8 bytes each) in one large value, at that scale. */
const CJK = Math.floor(99_000 / SCALE);

/** Grow a real room through accepted steps, including under the scaled byte limits. */
async function largeRoom() {
  const clients = await room3();
  const { a, settle } = clients;
  const nodes = Array.from({ length: 2_000 }, (_, i) => ({
    id: `bulk${i}`,
    stencil: "postgres",
    label: "x".repeat(200),
    x: i,
    y: 0,
  }));
  const initialNodes = a.diagram!.nodes.length;
  let edits = 0;
  for (let offset = 0; offset < nodes.length;) {
    const before = a.diagram!;
    let count = nodes.length - offset;
    let next = { ...before, nodes: [...before.nodes, ...nodes.slice(offset, offset + count)] };
    while (!checkCommands(commandsFromDiff(before, next)).ok && count > 1) {
      count = Math.floor(count / 2);
      next = { ...before, nodes: [...before.nodes, ...nodes.slice(offset, offset + count)] };
    }
    expect(checkCommands(commandsFromDiff(before, next)).ok).toBe(true);
    expect(a.edit(() => next)).toBe(true);
    edits++;
    offset += count;
    await settle();
  }
  expect(edits).toBeGreaterThan(1);
  for (const client of clients.clients) {
    expect(client.diagram?.nodes).toHaveLength(initialNodes + nodes.length);
    expect(client.projection()).toBe(a.projection());
  }
  return clients;
}

const labels = (c: TestClient) => c.diagram?.nodes.map((n) => n.label);

describe("sessions", () => {
  it("never let a Private or local-only diagram join, and send nothing for one", async () => {
    const net = new MemoryNetwork();
    const sent: unknown[] = [];
    net.tap((r) => sent.push(r));
    for (const privacy of [
      { private: true },
      { localOnly: true },
      { diagram: { ...canaryDiagram(), private: true } },
    ]) {
      await expect(
        CollabSession.open({
          room,
          transport: net.connect(),
          privacy,
          initial: canaryDiagram(),
          clock: new FakeClock(),
        }),
      ).rejects.toBeInstanceOf(PrivateDiagramError);
    }
    expect(sent).toEqual([]);
  });

  it("a joiner with nobody online has no document and can't edit", async () => {
    const net = new MemoryNetwork();
    const b = await openClient("b", net.connect(), room, new FakeClock(), 2);
    expect(b.session.hasDocument).toBe(false);
    expect(b.session.status).toBe("waiting");
    expect(b.ready).toBe(false);
    expect(b.edit((d) => ({ ...d, title: "x" }))).toBe(false);
  });

  it("joiners get the creator's diagram, and see each other's edits", async () => {
    const { a, b, c, settle } = await room3();
    expect(b.diagram?.title).toBe(a.diagram?.title);
    b.edit((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, label: `${n.label}!` })) }));
    await settle();
    expect(labels(a)).toEqual(labels(b));
    expect(labels(c)).toEqual(labels(b));
    expect(a.session.status).toBe("connected");
  });

  it("new elements get ids no one else picks, across a rejoin and between people with the same alias", async () => {
    const net = new MemoryNetwork();
    const clock = new FakeClock();
    const a = await openClient("same", net.connect(), room, clock, 1, { initial: canaryDiagram() });
    let b = await openClient("same", net.connect(), room, clock, 2);
    const clients = () => [a, b];
    const settle = () => net.settle(async () => void (await Promise.all(clients().map((x) => x.session.idle()))));
    await settle();
    const add = (c: typeof a) =>
      c.edit((d) => ({ ...d, nodes: [...d.nodes, { id: c.newId("n"), stencil: "postgres", label: "", x: 0, y: 0 }] }));
    add(a);
    add(b);
    await settle();
    const doc = b.session.doc;
    const diagram = b.diagram;
    await b.session.leave();
    b = await openClient("same", net.connect(), room, clock, 3, { doc });
    b.diagram = diagram;
    await settle();
    add(b);
    await settle();
    expect(a.diagram?.nodes).toHaveLength(5);
    expect(new Set(a.diagram?.nodes.map((n) => n.id)).size).toBe(5);
  });

  it("Undo is per person across the room", async () => {
    const { a, b, settle } = await room3();
    a.edit((d) => ({ ...d, title: "A's" }));
    await settle();
    b.edit((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === "intake" ? { ...n, label: "B's" } : n)) }));
    await settle();
    expect(a.binding.undo()).toBe(true);
    await settle();
    expect(b.diagram?.title).toBe(canaryDiagram().title);
    expect(b.diagram?.nodes[0].label).toBe("B's");
    expect(b.binding.undo()).toBe(true);
    expect(b.binding.undo()).toBe(false);
  });

  it("leaves the room when the diagram turns Private, sending nothing more", async () => {
    const { net, a, b, settle } = await room3();
    let wire = 0;
    net.tap(() => wire++);
    a.diagram = { ...a.diagram!, private: true, title: "Secret now" };
    expect(a.binding.localChanged()).toBe(false);
    await a.session.idle();
    const afterLeave = wire; // the goodbye
    await settle();
    expect(a.session.status).toBe("left");
    expect(b.diagram?.title).not.toBe("Secret now");
    a.diagram = { ...a.diagram, title: "Still secret" };
    a.binding.localChanged();
    await settle();
    expect(wire).toBe(afterLeave);
  });

  it("a remote change never clears this device's Private flag on the editor's diagram", async () => {
    const { a, b, settle } = await room3();
    // b's own editor marks its copy private locally (it would then leave on its next step).
    b.diagram = { ...b.diagram!, private: true };
    a.edit((d) => ({ ...d, title: "From A" }));
    await settle();
    expect(b.diagram?.title).toBe("From A");
    expect(b.diagram?.private).toBe(true);
  });

  it("refuses a local step the room would refuse, reverting the editor, so nobody quarantines an honest person", async () => {
    const { net, a, b, settle } = await room3();
    let wire = 0;
    net.tap(() => wire++);
    expect(a.edit((d) => ({ ...d, title: "x".repeat(COLLAB_LIMITS.maxStringChars + 1) }))).toBe(false);
    expect(a.binding.refused).toBe("string-too-long");
    expect(refusalMessage("string-too-long")).toMatch(/wasn't shared/);
    expect(a.diagram?.title).toBe(canaryDiagram().title);
    expect(a.edit((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, props: { ["k".repeat(300)]: 1 } })) }))).toBe(
      false,
    );
    expect(a.binding.refused).toBe("key-too-long");
    await settle();
    expect(wire).toBe(0);
    // And the next ordinary step goes through as usual.
    a.edit((d) => ({ ...d, title: "Fine" }));
    await settle();
    expect(b.diagram?.title).toBe("Fine");
    expect(b.session.stats.rejected).toEqual({});
  });

  it("refuses a step whose UTF-8 encoding is past the step bound, however short it is in characters", async () => {
    scaledLimits();
    const { net, a, b, settle } = await room3();
    let wire = 0;
    net.tap(() => wire++);
    // 60 values of 99,000 three-byte characters: 6 million characters, 18 MB encoded.
    const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`x${i}`, "\u4e2d".repeat(CJK)]));
    expect(a.edit((d) => ({ ...d, ...big }))).toBe(false);
    expect(a.binding.refused).toBe("too-large");
    expect(Object.keys(a.diagram!)).not.toContain("x0");
    await settle();
    expect(wire).toBe(0);
    expect(a.edit((d) => ({ ...d, title: "Next" }))).toBe(true);
    await settle();
    expect(b.diagram?.title).toBe("Next");
  });

  it("a newcomer joins after concurrent steps take the room past a reply bucket's worth", async () => {
    scaledLimits();
    const { net, clock, a, b, c, settle } = await room3();
    const chunk = (k: number) =>
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`z${k}_${i}`, "\u4e2d".repeat(CJK)]));
    for (const k of [1, 2, 3]) {
      expect(a.edit((d) => ({ ...d, ...chunk(k) }))).toBe(true);
      await settle();
    }
    // Concurrently, past the soft room bound: each side's own check passed.
    expect(b.edit((d) => ({ ...d, ...chunk(4) }))).toBe(true);
    expect(c.edit((d) => ({ ...d, ...chunk(5) }))).toBe(true);
    await settle();
    expect(a.session.doc.encodeDiff().length).toBeGreaterThan(COLLAB_LIMITS.maxRoomBytes);
    // And now the room refuses to grow further.
    expect(a.edit((d) => ({ ...d, ...chunk(6) }))).toBe(false);
    expect(a.binding.refused).toBe("room-full");
    // Big messages travel as fragments: no frame on the wire is larger than one.
    let largest = 0;
    net.tap((r) => void (largest = Math.max(largest, r.bytes.length)));
    const d = await openClient("d", net.connect(), room, clock, 15);
    const all = () => net.settle(async () => void (await Promise.all([a, b, c, d].map((x) => x.session.idle()))));
    await all();
    for (let i = 0; i < 4 && d.projection() !== a.projection(); i++) {
      clock.advance(COLLAB_LIMITS.antiEntropyMs * 2);
      await all();
    }
    expect(d.projection()).toBe(a.projection());
    expect(largest).toBeLessThanOrEqual(COLLAB_LIMITS.maxDocFrameBytes);
    expect(d.session.stats.rejected).toEqual({});
  }, 60_000);

  it("one person's Undo history can't grow the room without bound", async () => {
    scaledLimits();
    const { net, clock, a, b, settle } = await room3();
    const value = (k: number) => ({ big: `${k}`.padEnd(3, "-") + "\u4e2d".repeat(CJK) });
    for (let k = 0; k < 12; k++) {
      // Each replaces the last 3 MB value: without a bound, Undo would keep every replaced one.
      expect(
        a.edit((d) => ({ ...d, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`h${i}`, value(k).big])) })),
      ).toBe(true);
      await settle();
    }
    expect(a.session.doc.encodeDiff().length).toBeLessThan(COLLAB_LIMITS.maxRoomBytes);
    // Recent steps can still be undone.
    expect(a.binding.undo()).toBe(true);
    await settle();
    expect(String(metaOf(b.session.doc.ydoc).get("h0")).startsWith("10")).toBe(true);
    const d = await openClient("d", net.connect(), room, clock, 16);
    await net.settle(async () => void (await Promise.all([a, b, d].map((x) => x.session.idle()))));
    expect(d.projection()).toBe(a.projection());
  }, 60_000);

  it("measures the room once, not once per refused edit", async () => {
    scaledLimits();
    const { a } = await room3();
    const chunk = (k: number) =>
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`w${k}_${i}`, "\u4e2d".repeat(CJK)]));
    for (const k of [1, 2, 3, 4]) expect(a.edit((d) => ({ ...d, ...chunk(k) }))).toBe(true);
    const before = a.session.doc.stats.roomMeasurements;
    for (let i = 0; i < 5; i++) {
      expect(a.edit((d) => ({ ...d, ...chunk(9) }))).toBe(false);
      expect(a.binding.refused).toBe("room-full");
    }
    expect(a.session.doc.stats.roomMeasurements - before).toBeLessThanOrEqual(1);
  }, 60_000);

  it("refuses to start a room with a diagram the room couldn't carry", async () => {
    const net = new MemoryNetwork();
    await expect(
      openClient("a", net.connect(), room, new FakeClock(), 1, {
        initial: { ...canaryDiagram(), title: "x".repeat(200_000) },
      }),
    ).rejects.toThrow(/beyond what a room can carry/);
  });

  it("stops its timers and transport on leave", async () => {
    const { clock, a, b, c, settle } = await room3();
    for (const x of [a, b, c]) await x.session.leave();
    await settle();
    expect(clock.pending).toBe(0);
    expect(a.session.status).toBe("left");
  });
});

describe("sessions refuse hostile input", () => {
  it("frames under the wrong key are counted and ignored", async () => {
    const { net, a, b, settle } = await room3();
    const outsider = await rogue(net, roomFor(2));
    await outsider.send("doc", frame(DOC.update, Y.encodeStateAsUpdate(new Y.Doc())));
    await settle();
    expect(a.session.stats.rejected["auth-failed"]).toBe(1);
    expect(b.session.stats.rejected["auth-failed"]).toBe(1);
  });

  it("a network replaying every frame it saw changes nothing", async () => {
    const { net, a, b, c, settle } = await room3();
    const seen: { to: string; bytes: Uint8Array }[] = [];
    const untap = net.tap((r) => seen.push({ to: r.to, bytes: r.bytes }));
    a.edit((d) => ({ ...d, title: "One" }));
    b.edit((d) => ({ ...d, title: "Two" }));
    await settle();
    const before = [a, b, c].map((x) => x.session.doc.project());
    untap();
    const attacker = net.connect();
    for (const { to, bytes } of seen) attacker.send(bytes, to);
    await settle();
    expect([a, b, c].map((x) => x.session.doc.project().diagram)).toEqual(before.map((p) => p.diagram));
    const replays = [a, b, c].reduce((n, x) => n + (x.session.stats.rejected.replay ?? 0), 0);
    expect(replays).toBe(seen.length);
  });

  it("a member sending a hostile update is quarantined; honest peers stay converged", async () => {
    const { net, a, b, c, settle } = await room3();
    const evil = await rogue(net);
    const doc = new Y.Doc();
    doc.getMap("evil-root").set("x", 1);
    await evil.send("doc", frame(DOC.update, Y.encodeStateAsUpdate(doc)));
    await settle();
    for (const x of [a, b, c]) expect(x.session.stats.rejected["unknown-root"]).toBe(1);
    // Everything else it sends is ignored, valid or not.
    const ok = new Y.Doc();
    ok.getMap("meta").set("title", "Hijacked");
    await evil.send("doc", frame(DOC.update, Y.encodeStateAsUpdate(ok)));
    await settle();
    for (const x of [a, b, c]) {
      expect(x.session.stats.rejected.quarantined).toBe(1);
      expect(x.diagram?.title).toBe(canaryDiagram().title);
    }
  });

  it("refuses malformed presence and unknown message types", async () => {
    const { net, a, settle } = await room3();
    const evil = await rogue(net);
    await evil.send(
      "presence",
      frame(PRESENCE.state, textToBytes(JSON.stringify({ alias: "x", colour: 99, status: "active" }))),
    );
    await evil.send(
      "presence",
      frame(PRESENCE.state, textToBytes(JSON.stringify({ alias: "x", colour: 1, status: "active", extra: 1 }))),
    );
    await evil.send("doc", frame(42));
    await evil.send("doc", new Uint8Array());
    await settle();
    expect(a.session.stats.rejected.malformed).toBe(4);
    expect(a.session.peers().map((p) => p.alias)).toEqual(["b", "c"]);
  });

  it("rate-limits a sender flooding document frames", async () => {
    scaledLimits();
    const { net, a, settle } = await room3();
    const evil = await rogue(net);
    const big = frame(DOC.syncRequest, new Uint8Array(COLLAB_LIMITS.maxDocFrameBytes - 1024));
    // The payload is a garbage state vector: each one costs the receiver a decode, so the bucket bounds them.
    const sends = Math.ceil(COLLAB_LIMITS.senderBytesPerWindow / big.length) + 3;
    for (let i = 0; i < sends; i++) await evil.send("doc", big);
    await settle();
    expect(a.session.stats.rejected["rate-limited"]).toBeGreaterThanOrEqual(3);
  });

  it("throttles what it sends back to a member who keeps asking for the whole room", async () => {
    scaledLimits();
    const { net, a, settle } = await largeRoom();
    const fullState = a.session.doc.encodeDiff();
    const fullStateBytes = fullState.length;
    expect(fullStateBytes * COLLAB_LIMITS.syncRequestsPerWindow).toBeGreaterThan(COLLAB_LIMITS.replyBytesPerWindow);
    const evil = await rogue(net);
    await settle(); // Exclude the new transport peer's initial sync/presence traffic.
    let replyTraffic = 0;
    const untap = net.tap((r) => {
      if (r.from === a.session.transport.self && r.to === evil.transport.self) replyTraffic += r.bytes.length;
    });
    onTestFinished(untap);
    const encode = vi.spyOn(a.session.doc, "encodeDiff");
    const asks = 100;
    for (let i = 0; i < asks; i++) await evil.send("doc", frame(DOC.syncRequest, new Uint8Array([0])));
    await settle();
    // Requests past the budget are refused before any encoding; replies past the byte budget aren't sent.
    expect(a.session.stats.rejected["request-throttled"]).toBeGreaterThanOrEqual(
      asks - COLLAB_LIMITS.syncRequestsPerWindow,
    );
    expect(encode.mock.calls.length).toBeLessThanOrEqual(COLLAB_LIMITS.syncRequestsPerWindow);
    const sent = Math.floor(COLLAB_LIMITS.replyBytesPerWindow / fullStateBytes);
    const throttled = a.session.stats.rejected["reply-throttled"] ?? 0;
    expect(throttled).toBeGreaterThan(0);
    expect(throttled).toBeGreaterThanOrEqual(COLLAB_LIMITS.syncRequestsPerWindow - sent);
    const reply = frame(DOC.syncReply, fullState);
    const frames = reply.length > COLLAB_LIMITS.maxFragmentBytes ? fragment(reply, 1) : [reply];
    // The byte bucket charges update bytes; the wire also carries framing, envelope headers and 16-byte GCM tags.
    const wireBytesPerReply = frames.reduce((bytes, f) => bytes + f.length + HEADER_BYTES + 16, 0);
    expect(replyTraffic).toBeGreaterThan(0);
    expect(replyTraffic).toBeLessThanOrEqual(sent * wireBytesPerReply);
  });

  it("a member's update with a huge array can't break the receive queue, and leave still cleans up", async () => {
    const { net, clock, a, b, settle } = await room3();
    const evil = await rogue(net);
    const doc = new Y.Doc();
    doc.getMap("meta").set("planning", new Array(200_000).fill(0));
    await evil.send("doc", frame(DOC.update, Y.encodeStateAsUpdate(doc)));
    await settle();
    // The value is within every bound, so it's applied (the same everywhere); it isn't a valid planning model, so
    // the room's diagram reports invalid. The point here: later frames are still handled.
    expect(a.session.doc.project().status).toBe("invalid");
    b.edit((d) => ({ ...d, title: "Still working" }));
    await settle();
    expect(metaOf(a.session.doc.ydoc).get("title")).toBe("Still working");
    expect(a.session.stats.rejected.internal).toBeUndefined();
    for (const x of [a, b]) await x.session.leave();
    expect(a.session.status).toBe("left");
    expect(clock.pending).toBeGreaterThan(0); // c is still in
  });

  it("drops frames past the inbox bound before decrypting them", async () => {
    scaledLimits();
    const { a } = await room3();
    const s = a.session as unknown as { enqueue(from: string, bytes: Uint8Array): Promise<void> };
    const big = new Uint8Array(COLLAB_LIMITS.maxDocFrameBytes);
    const fits = Math.floor(COLLAB_LIMITS.maxQueuedBytesPerPeer / big.length);
    const pending = Array.from({ length: fits + 6 }, () => s.enqueue("flood", big));
    expect(a.session.stats.rejected["queue-full"]).toBe(6);
    await Promise.all(pending);
    expect(a.session.stats.rejected["bad-magic"]).toBe(fits);
  });

  it("an old-epoch member can't talk to the room", async () => {
    const { net, a, settle } = await room3();
    const stale = await rogue(net, { ...room, epoch: room.epoch + 1 });
    await stale.send("doc", frame(DOC.syncRequest, new Uint8Array([0])));
    await settle();
    expect(a.session.stats.rejected["future-epoch"]).toBe(1);
  });
});

describe("presence", () => {
  it("shows each peer's alias, colour and status over the encrypted channel", async () => {
    const { a, b, settle } = await room3();
    b.session.setPresence({ status: "idle" });
    await settle();
    const peers = a.session.peers();
    expect(peers.map((p) => [p.alias, p.status])).toEqual([
      ["b", "idle"],
      ["c", "active"],
    ]);
    expect(peers.every((p) => /^[0-9a-f]{32}$/.test(p.sender))).toBe(true);
  });

  it("expires a peer that stops refreshing (on the room clock), and drops one that says goodbye at once", async () => {
    const { net, clock, a, b, c, settle } = await room3();
    net.partition([[a.session.transport.self, b.session.transport.self], [c.session.transport.self]]);
    clock.advance(COLLAB_LIMITS.presenceTtlMs - COLLAB_LIMITS.presenceHeartbeatMs);
    await settle();
    expect(a.session.peers().map((p) => p.alias)).toEqual(["b", "c"]);
    clock.advance(COLLAB_LIMITS.presenceHeartbeatMs * 2);
    await settle();
    expect(a.session.peers().map((p) => p.alias)).toEqual(["b"]);
    await b.session.leave();
    await settle();
    expect(a.session.peers()).toEqual([]);
  });

  it("strips control and bidi-override characters from aliases", async () => {
    const { net, a, settle } = await room3();
    const evil = await rogue(net);
    await evil.send(
      "presence",
      frame(PRESENCE.state, textToBytes(JSON.stringify({ alias: "Ad‮min\u0007", colour: 1, status: "active" }))),
    );
    await settle();
    expect(a.session.peers().map((p) => p.alias)).toContain("Admin");
  });
});
