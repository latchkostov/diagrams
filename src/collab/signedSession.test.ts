import { describe, expect, it, onTestFinished, vi } from "vitest";
import { textToBytes } from "../interop/codec";
import { FakeClock } from "./clock";
import { Sealer } from "./envelope";
import { deriveRoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import { encodePresence } from "./presence";
import * as Y from "yjs";
import { DOC, frame, LIVE, PRESENCE } from "./protocol";
import { seededBytes } from "./random";
import { signEntry } from "./roster";
import { SignedRoom } from "./signedRoom";
import { newIdentity, type Identity } from "./signing";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { MemoryNetwork } from "./transport/memory";

// Signed rooms (P4) between sessions on the in-memory network: what's enforced against a peer that doesn't follow the
// rules (a modified copy holding the room key), and what honest peers do so it holds without a server.

interface Room {
  net: MemoryNetwork;
  clock: FakeClock;
  link: RoomLink;
  host: Identity;
  clients: TestClient[];
  settle(): Promise<void>;
  join(name: string, seed: number, identity?: Identity): Promise<TestClient>;
}

async function signedRoom(seed: number, opts: { viewOnly?: boolean } = {}): Promise<Room> {
  const net = new MemoryNetwork({ seed });
  const clock = new FakeClock();
  const host = await newIdentity();
  const link: RoomLink = { ...roomFor(seed), hostKey: host.key };
  const clients: TestClient[] = [];
  const settle = () => net.settle(async () => void (await Promise.all(clients.map((x) => x.session.idle()))));
  const a = await openClient("a", net.connect(), link, clock, seed * 10 + 1, {
    initial: canaryDiagram(),
    signed: { identity: host },
  });
  clients.push(a);
  onTestFinished(() => a.session.leave());
  if (opts.viewOnly) expect(await a.session.appendRoster("policy", { viewOnly: true })).toBe(true);
  const join = async (name: string, s: number, identity?: Identity) => {
    const c = await openClient(name, net.connect(), link, clock, s, {
      signed: { identity: identity ?? (await newIdentity()) },
    });
    clients.push(c);
    onTestFinished(() => c.session.leave());
    await settle();
    return c;
  };
  await settle();
  return { net, clock, link, host, clients, settle, join };
}

const title = (c: TestClient) => c.session.doc.project().diagram?.title;
const rejected = (c: TestClient, reason: string) =>
  (c.session.stats.rejected as Record<string, number | undefined>)[reason] ?? 0;

/** A peer that runs the code but not the rules: its session believes it may edit (a modified copy). */
function unruly(c: TestClient): void {
  Object.defineProperty(c.session, "canEdit", { get: () => true });
  Object.defineProperty(c.session.signed!, "canEdit", { get: () => true });
}

/** `from`'s next broadcasts reach only `to` (one peer missing them, without anyone reconnecting). */
function onlyTo(from: TestClient, to: TestClient): () => void {
  const t = from.session.transport;
  const send = t.send.bind(t);
  t.send = (bytes, peer) => send(bytes, peer ?? to.session.transport.self);
  return () => {
    t.send = send;
  };
}

describe("signed rooms", () => {
  it("a dropped sender admitted later is asked again and recovers the full diagram", async () => {
    const r = await signedRoom(49, { viewOnly: true });
    const [host] = r.clients;
    const viewer = await r.join("viewer", 492);
    const sendHost = host.session as unknown as { sendDoc(message: Uint8Array, to?: string): void };
    const send = sendHost.sendDoc.bind(sendHost);
    const spy = vi.spyOn(sendHost, "sendDoc").mockImplementation((message, to) => {
      if (message[0] !== DOC.syncReply) send(message, to);
    });
    onTestFinished(() => spy.mockRestore());
    const joiner = await r.join("joiner", 493);
    expect(joiner.session.hasDocument).toBe(false);
    // A valid reply from a viewer cannot count yet. Its held reply expires, without a quarantine.
    (viewer.session as unknown as { sendDoc(message: Uint8Array, to?: string): void }).sendDoc(
      frame(DOC.syncReply, Y.encodeStateAsUpdate(viewer.session.doc.ydoc)),
      joiner.session.transport.self,
    );
    await r.settle();
    r.clock.advance(COLLAB_LIMITS.heldMs);
    await r.settle();
    expect(rejected(joiner, "held-dropped")).toBeGreaterThan(0);
    expect(joiner.session.diagnostics().behind).toBeGreaterThan(0);
    expect(joiner.session.hasDocument).toBe(false);
    expect(await host.session.appendRoster("admit", { who: viewer.session.signed!.key })).toBe(true);
    await r.settle();
    expect(joiner.session.hasDocument).toBe(true);
    expect(joiner.diagram).toEqual(host.diagram);
    expect(joiner.projection()).toBe(host.projection());
    expect(rejected(joiner, "quarantined")).toBe(0);
  });

  it("newcomers in a room where new people may edit are admitted, and their edits reach everyone", async () => {
    const r = await signedRoom(31);
    const b = await r.join("b", 312);
    const c = await r.join("c", 313);
    await r.settle();
    for (const x of [b, c]) expect(x.session.signed!.isEditor(x.session.signed!.key)).toBe(true);
    expect(b.edit((d) => ({ ...d, title: "From b" }))).toBe(true);
    await r.settle();
    expect(r.clients.map(title)).toEqual(["From b", "From b", "From b"]);
    // One admit each, by the host: nobody else signed one.
    const log = r.clients[0].session.signed!.roster.log();
    expect(log.filter((e) => e.op === "admit").map((e) => e.by)).toEqual([r.host.key, r.host.key]);
  });

  it("a viewer's edit is undone at once; one sent anyway (a modified copy) is ignored by everyone", async () => {
    const r = await signedRoom(32, { viewOnly: true });
    const [a] = r.clients;
    const b = await r.join("b", 322);
    const v = await r.join("v", 323);
    // b can only view too, until the host lets them edit.
    expect(await a.session.appendRoster("admit", { who: b.session.signed!.key })).toBe(true);
    await r.settle();
    expect(v.session.canEdit).toBe(false);
    expect(v.edit((d) => ({ ...d, title: "Vandalised" }))).toBe(false);
    expect(v.binding.refused).toBe("view-only");
    expect(title(v)).toBe(canaryDiagram().title);
    // A modified copy sends its edit anyway: held by everyone, never applied, then dropped with its sender.
    unruly(v);
    expect(v.edit((d) => ({ ...d, title: "Vandalised" }))).toBe(true);
    await r.settle();
    for (const x of [a, b]) expect(title(x)).toBe(canaryDiagram().title);
    r.clock.advance(COLLAB_LIMITS.heldMs + 1);
    await r.settle();
    for (const x of [a, b]) {
      expect(title(x)).toBe(canaryDiagram().title);
      expect(rejected(x, "unauthorised")).toBeGreaterThan(0);
      expect(x.session.peers().some((p) => p.sender === v.session.senderId)).toBe(false);
    }
    // The room goes on: b's edits count.
    expect(b.edit((d) => ({ ...d, title: "From b" }))).toBe(true);
    await r.settle();
    expect([a, b].map(title)).toEqual(["From b", "From b"]);
  });

  it("an edit that raced its grant is held, not refused: it counts once the grant arrives", async () => {
    const r = await signedRoom(33, { viewOnly: true });
    const [a] = r.clients;
    const b = await r.join("b", 332);
    const c = await r.join("c", 333);
    expect(await a.session.appendRoster("admit", { who: c.session.signed!.key })).toBe(true);
    await r.settle();
    // b edits a moment before the host's "Can edit" reaches anyone.
    unruly(b);
    expect(b.edit((d) => ({ ...d, title: "Raced" }))).toBe(true);
    await r.settle();
    expect([a, c].map(title)).toEqual([canaryDiagram().title, canaryDiagram().title]);
    expect(await a.session.appendRoster("admit", { who: b.session.signed!.key })).toBe(true);
    await r.settle();
    expect(r.clients.map(title)).toEqual(["Raced", "Raced", "Raced"]);
    for (const x of [a, c]) expect(rejected(x, "unauthorised")).toBe(0);
  });

  it("viewers never serve sync: with no editor here, a newcomer gets no document from them", async () => {
    const r = await signedRoom(34, { viewOnly: true });
    const [a] = r.clients;
    const v = await r.join("v", 342);
    expect(v.session.hasDocument).toBe(true);
    await a.session.leave();
    const late = await r.join("late", 343);
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs * 2);
    await r.settle();
    expect(late.session.hasDocument).toBe(false);
  });

  it("a frame forged under a member's sender id is refused, and doesn't use up that member's counters", async () => {
    const r = await signedRoom(35);
    const [a] = r.clients;
    const b = await r.join("b", 352);
    await r.settle();
    // Mallory holds the room key (anyone with the link does) and seals a frame as b, signed with her own key.
    const mallory = await newIdentity();
    const keys = await deriveRoomKeys(r.link);
    const bytes = Uint8Array.from(b.session.senderId.match(/../g)!.map((h) => parseInt(h, 16)));
    const sealer = new Sealer(keys, bytes);
    sealer.sign = new SignedRoom(keys, r.host.key, mallory).signFrame;
    const next = (b.session as unknown as { sealer: { counters: { doc: number } } }).sealer.counters.doc;
    (sealer as unknown as { counters: { doc: number } }).counters.doc = next;
    const evil = r.net.connect();
    onTestFinished(() => evil.close());
    await r.settle();
    evil.send(await sealer.seal("doc", frame(DOC.syncRequest, new Uint8Array([0]))));
    await r.settle();
    expect(rejected(a, "bad-signature")).toBe(1);
    // b's own frame with that counter still counts.
    expect(b.edit((d) => ({ ...d, title: "Still b" }))).toBe(true);
    await r.settle();
    expect(title(a)).toBe("Still b");
    expect(rejected(a, "replay")).toBe(0);
  });

  it("a forged roster entry is refused by everyone, and a viewer can't grant itself anything", async () => {
    const r = await signedRoom(36, { viewOnly: true });
    const [a] = r.clients;
    const b = await r.join("b", 362);
    const v = await r.join("v", 363);
    expect(await a.session.appendRoster("admit", { who: b.session.signed!.key })).toBe(true);
    await r.settle();
    // The viewer can't make entries (its session won't), so it sends them raw: one claiming to be the host's, one
    // its own.
    const signed = v.session.signed!;
    const mine = await signEntry(signed.identity, r.clients[0].session.keys.roomId, 0, {
      n: 1,
      op: "cohost",
      who: signed.key,
      deps: [],
    });
    const theirs = await signEntry(signed.identity, r.clients[0].session.keys.roomId, 0, {
      n: 1,
      op: "admit",
      who: signed.key,
      deps: [],
    });
    const forged = { ...theirs, by: r.host.key };
    const keys = await deriveRoomKeys(r.link);
    const sealer = new Sealer(keys, seededBytes(77)(16));
    const room = new SignedRoom(keys, r.host.key, signed.identity);
    sealer.sign = room.signFrame;
    const binding = await room.bindMine(sealer.sender, 4242);
    const evil = r.net.connect();
    onTestFinished(() => evil.close());
    await r.settle();
    evil.send(
      await sealer.seal(
        "presence",
        frame(PRESENCE.state, encodePresence({ alias: "v2", colour: 1, status: "active", ...binding })),
      ),
    );
    evil.send(await sealer.seal("doc", frame(DOC.roster, textToBytes(JSON.stringify({ e: [mine, forged] })))));
    await r.settle();
    for (const x of [a, b]) {
      expect(rejected(x, "roster-refused")).toBe(2);
      expect(x.session.signed!.state().cohosts).toEqual([]);
      expect(x.session.signed!.isEditor(signed.key)).toBe(false);
    }
  });

  it("rosters converge: a late joiner gets the whole roster", async () => {
    const r = await signedRoom(37);
    const [a] = r.clients;
    const b = await r.join("b", 372);
    expect(await a.session.appendRoster("cohost", { who: b.session.signed!.key })).toBe(true);
    expect(await a.session.appendRoster("drive", { who: b.session.signed!.key })).toBe(true);
    await r.settle();
    const c = await r.join("c", 373);
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    const states = r.clients.map((x) => {
      const s = x.session.signed!.state();
      return JSON.stringify([s.host, s.cohosts, s.driver, [...s.editors].sort()]);
    });
    expect(new Set(states).size).toBe(1);
    expect(c.session.signed!.state().cohosts).toEqual([b.session.signed!.key]);
  });

  it("signature checks are bounded per sender: a flood past the budget is dropped unverified", async () => {
    const r = await signedRoom(38);
    const [a] = r.clients;
    const keys = await deriveRoomKeys(r.link);
    const mallory = await newIdentity();
    const sealer = new Sealer(keys, seededBytes(78)(16));
    const room = new SignedRoom(keys, r.host.key, mallory);
    sealer.sign = room.signFrame;
    const binding = await room.bindMine(sealer.sender, 99);
    const evil = r.net.connect();
    onTestFinished(() => evil.close());
    await r.settle();
    evil.send(
      await sealer.seal(
        "presence",
        frame(PRESENCE.state, encodePresence({ alias: "m", colour: 1, status: "active", ...binding })),
      ),
    );
    await r.settle();
    const verify = vi.spyOn(globalThis.crypto.subtle, "verify");
    onTestFinished(() => verify.mockRestore());
    // Small document frames are cheap to send (well inside the byte bucket) and each costs a verification: the
    // budget bounds them. Live frames past their own bound are dropped before any.
    const flood = COLLAB_LIMITS.verifiesPerWindow + 50;
    for (let i = 0; i < flood; i++) evil.send(await sealer.seal("doc", frame(DOC.syncAck, new Uint8Array(32))));
    const live = COLLAB_LIMITS.liveFramesPerWindow + 20;
    for (let i = 0; i < live; i++) evil.send(await sealer.seal("live", frame(LIVE.message, textToBytes("{}"))));
    await r.settle();
    expect(verify.mock.calls.length).toBeLessThanOrEqual(COLLAB_LIMITS.verifiesPerWindow);
    expect(rejected(a, "verify-throttled")).toBeGreaterThanOrEqual(50 + COLLAB_LIMITS.liveFramesPerWindow);
    expect(rejected(a, "live-throttled")).toBe(20);
    // A window later, the sender's frames are checked again.
    verify.mockClear();
    r.clock.advance(COLLAB_LIMITS.senderWindowMs);
    evil.send(await sealer.seal("doc", frame(DOC.syncAck, new Uint8Array(32))));
    await r.settle();
    expect(verify.mock.calls.length).toBe(1);
  }, 60_000);

  it("with no host or co-host here, an editor doesn't admit a newcomer: they view until one is back", async () => {
    const r = await signedRoom(43);
    const [a] = r.clients;
    const b = await r.join("b", 432);
    expect(b.session.canEdit).toBe(true);
    // The host's connection goes (no handover): only b, a plain editor, is here.
    await a.session.leave();
    await r.settle();
    const n = await r.join("n", 433);
    await r.settle();
    expect(b.session.signed!.isEditor(n.session.signed!.key)).toBe(false);
    expect(n.session.canEdit).toBe(false);
    expect(n.edit((d) => ({ ...d, title: "Too soon" }))).toBe(false);
    expect(n.binding.refused).toBe("view-only");
  });

  it("a lost grant is recovered by roster anti-entropy, and the edit waiting for it applies in time", async () => {
    const r = await signedRoom(39, { viewOnly: true });
    const [a] = r.clients;
    const b = await r.join("b", 392);
    const c = await r.join("c", 393);
    // The host's "Can edit" for b reaches b, but not c.
    const restore = onlyTo(a, b);
    expect(await a.session.appendRoster("admit", { who: b.session.signed!.key })).toBe(true);
    await r.settle();
    restore();
    expect(b.session.canEdit).toBe(true);
    expect(c.session.signed!.roster.size).toBe(a.session.signed!.roster.size - 1);
    expect(b.edit((d) => ({ ...d, title: "From b" }))).toBe(true);
    await r.settle();
    expect(title(c)).toBe(canaryDiagram().title);
    // Nobody reconnects: the next anti-entropy round's summaries say c's roster differs, and c gets the entries.
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(c.session.signed!.roster.log()).toEqual(a.session.signed!.roster.log());
    expect(title(c)).toBe("From b");
    expect(rejected(c, "unauthorised")).toBe(0);
  });

  it("only the held sender can supply its own missing grant: its roster isn't stuck behind its held edit", async () => {
    const r = await signedRoom(40, { viewOnly: true });
    const [a] = r.clients;
    const b = await r.join("b", 402);
    const c = await r.join("c", 403);
    const restore = onlyTo(a, b);
    expect(await a.session.appendRoster("admit", { who: b.session.signed!.key })).toBe(true);
    await r.settle();
    restore();
    // The host goes: only b has the grant c lacks.
    await a.session.leave();
    await r.settle();
    expect(b.edit((d) => ({ ...d, title: "From b" }))).toBe(true);
    await r.settle();
    expect(title(c)).toBe(canaryDiagram().title);
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(c.session.signed!.isEditor(b.session.signed!.key)).toBe(true);
    expect(title(c)).toBe("From b");
    expect(rejected(c, "unauthorised")).toBe(0);
    expect(c.session.peers().some((p) => p.sender === b.session.senderId)).toBe(true);
  });

  it("a held update is read once: frames after it don't make it decoded again, and they're handled meanwhile", async () => {
    const r = await signedRoom(41);
    const [a] = r.clients;
    const b = await r.join("b", 412);
    await r.settle();
    expect(a.session.signed!.isEditor(b.session.signed!.key)).toBe(true);
    // b's update carries another Yjs client's structs: it doesn't count (not b's bound client), so it's held.
    const other = new Y.Doc();
    other.clientID = 777;
    other.getMap("meta").set("title", "Not b's");
    const send = (message: Uint8Array) => (b.session as unknown as { sendDoc(m: Uint8Array): void }).sendDoc(message);
    const counts = vi.spyOn(a.session as unknown as { counts(...args: unknown[]): boolean }, "counts");
    send(frame(DOC.update, Y.encodeStateAsUpdate(other)));
    await r.settle();
    for (let i = 0; i < 30; i++) send(frame(DOC.syncAck, new Uint8Array(32)));
    await r.settle();
    expect(counts).toHaveBeenCalledTimes(1);
    // The frames after it were handled (not held behind it): only the update waits.
    const held = (a.session as unknown as { held: Map<string, { blocked: unknown[] }> }).held;
    expect(held.get(b.session.senderId)?.blocked).toHaveLength(1);
    expect(title(a)).toBe(canaryDiagram().title);
  });

  it("decodes a held update once across roster and binding changes, rechecks it on each, and applies it once it counts", async () => {
    const r = await signedRoom(44);
    const [a] = r.clients;
    const b = await r.join("b", 442);
    const c = await r.join("c", 443);
    await r.settle();
    const other = new Y.Doc();
    other.clientID = 778;
    other.getMap("meta").set("title", "From client 778");
    const decodes = vi.spyOn(a.session as unknown as { updateClients(p: Uint8Array): unknown }, "updateClients");
    const counts = vi.spyOn(a.session as unknown as { counts(...args: unknown[]): boolean }, "counts");
    (b.session as unknown as { sendDoc(m: Uint8Array): void }).sendDoc(frame(DOC.update, Y.encodeStateAsUpdate(other)));
    await r.settle();
    expect(title(a)).toBe(canaryDiagram().title);
    // Roster changes (each a new authorisation revision): rechecked each time, never decoded again.
    expect(await a.session.appendRoster("cohost", { who: c.session.signed!.key })).toBe(true);
    await r.settle();
    expect(await a.session.appendRoster("drive", { who: c.session.signed!.key })).toBe(true);
    await r.settle();
    // A binding change that doesn't help it (c's new client id): rechecked, still not decoded again.
    c.session.doc.ydoc.clientID = 4321;
    (c.session as unknown as { rebind(): void }).rebind();
    await r.settle();
    expect(c.session.signed!.mine?.client).toBe(4321);
    expect(decodes).toHaveBeenCalledTimes(1);
    expect(counts.mock.calls.length).toBeGreaterThanOrEqual(4);
    // b binds the client its update carries: it counts now, and applies.
    b.session.doc.ydoc.clientID = 778;
    (b.session as unknown as { rebind(): void }).rebind();
    await r.settle();
    expect(title(a)).toBe("From client 778");
    expect(decodes).toHaveBeenCalledTimes(1);
  });

  it("an older presence frame's binding never replaces a newer one's", async () => {
    const r = await signedRoom(42);
    const keys = await deriveRoomKeys(r.link);
    const mallory = await newIdentity();
    const sender = seededBytes(80)(16);
    const hex = Array.from(sender, (x) => x.toString(16).padStart(2, "0")).join("");
    const theirs = new SignedRoom(keys, r.host.key, mallory);
    const first = await theirs.bindMine(sender, 1);
    const second = await theirs.bindMine(sender, 2);
    const mine = new SignedRoom(keys, r.host.key, r.host);
    expect(await mine.bindPeer(hex, sender, second, 5)).toBe("bound");
    expect(await mine.bindPeer(hex, sender, first, 4)).toBe("same");
    expect(mine.clientOf(hex)).toBe(2);
    expect(await mine.bindPeer(hex, sender, first, 6)).toBe("bound");
    expect(mine.clientOf(hex)).toBe(1);
  });
});
