import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { textToBytes } from "../interop/codec";
import { FakeClock } from "./clock";
import { Sealer } from "./envelope";
import { deriveRoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import { DOC, frame, PRESENCE } from "./protocol";
import { seededBytes } from "./random";
import { CollabSession, PrivateDiagramError } from "./session";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { MemoryNetwork } from "./transport/memory";
import type { CollabTransport } from "./transport/types";

const room = roomFor(1);

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
    const { net, a, settle } = await room3();
    const evil = await rogue(net);
    const big = frame(DOC.syncRequest, new Uint8Array(COLLAB_LIMITS.maxDocFrameBytes - 1024));
    // The payload is a garbage state vector: each one costs the receiver a decode, so the bucket bounds them.
    const sends = Math.ceil(COLLAB_LIMITS.senderBytesPerWindow / big.length) + 3;
    for (let i = 0; i < sends; i++) await evil.send("doc", big);
    await settle();
    expect(a.session.stats.rejected["rate-limited"]).toBeGreaterThanOrEqual(3);
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
