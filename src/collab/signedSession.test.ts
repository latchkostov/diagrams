import { describe, expect, it, onTestFinished, vi } from "vitest";
import { textToBytes } from "../interop/codec";
import { FakeClock } from "./clock";
import { Sealer } from "./envelope";
import { deriveRoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import { encodePresence } from "./presence";
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

describe("signed rooms", () => {
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
      n: 50,
      op: "cohost",
      who: signed.key,
    });
    const theirs = await signEntry(signed.identity, r.clients[0].session.keys.roomId, 0, {
      n: 51,
      op: "admit",
      who: signed.key,
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

  it("rosters converge: a late joiner gets the whole roster, and a summary that differs heals a gap", async () => {
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
});
