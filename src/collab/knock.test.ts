import { describe, expect, it, onTestFinished, vi } from "vitest";
import { base64UrlToBytes, bytesToBase64Url } from "../interop/codec";
import { FakeClock } from "./clock";
import { Sealer } from "./envelope";
import { commitEpoch, MAX_EPOCHS, parseStart, scopeOf, signStart, type ChainData, type EpochStart } from "./epochs";
import { Opener } from "./envelope";
import { MAX_ENTRIES_PER_SIGNER, signEntry, SignedRoster } from "./roster";
import { deriveEpochKeys, deriveRoomKeys, newEpochSecret } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import { chainMessages, Lobby, MAX_LOBBY_MESSAGE_BYTES, parseBody, wrapFor, type LobbyBody } from "./lobby";
import { DOC, frame } from "./protocol";
import { textToBytes } from "../interop/codec";
import { seededBytes } from "./random";
import { KNOCK_TTL_MS, type KnockMember } from "./session";
import { CATCH_UP_MS } from "./chainCatchUp";
import { RoomRoster } from "./room/roomRoster";
import { WatchTogether } from "./room/watch";
import { newAgreement, newIdentity, type Agreement, type Identity } from "./signing";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { MemoryNetwork } from "./transport/memory";
import type { CollabTransport } from "./transport/types";

// Knock-to-join and Remove with re-key (meeting hosts design §2, P5), between sessions on the in-memory network.

interface Person {
  name: string;
  identity: Identity;
  agreement: Agreement;
  client?: TestClient;
}

const rejected = (c: TestClient, reason: string) =>
  (c.session.stats.rejected as Record<string, number | undefined>)[reason] ?? 0;
const title = (c: TestClient) => c.session.doc.project().diagram?.title;

async function knockRoom(seed: number) {
  const net = new MemoryNetwork({ seed });
  const clock = new FakeClock();
  const host: Person = { name: "host", identity: await newIdentity(), agreement: await newAgreement() };
  const link: RoomLink = { ...roomFor(seed), hostKey: host.identity.key, knock: true };
  const lobbyKeys = await deriveRoomKeys(link);
  const secret = newEpochSecret(seededBytes(seed + 1000));
  const start = await signStart(host.identity, lobbyKeys.roomId, {
    epoch: 0,
    kc: await commitEpoch(secret, lobbyKeys.roomId, 0),
    x: host.agreement.x,
  });
  const people: Person[] = [host];
  let opened = 0;
  const clients = () => people.filter((p) => p.client && p.client.session.status !== "left").map((p) => p.client!);
  const settle = () => net.settle(async () => void (await Promise.all(clients().map((x) => x.session.idle()))));
  const open = async (p: Person, member: KnockMember, transport: CollabTransport, initial = false) => {
    // A fresh seed per session (a reload draws a new sender id).
    p.client = await openClient(p.name, transport, link, clock, 7000 + seed * 100 + ++opened, {
      ...(initial ? { initial: canaryDiagram() } : {}),
      signed: { identity: p.identity, knock: member },
    });
    onTestFinished(() => p.client?.session.leave());
    return p.client;
  };
  await open(host, { agreement: host.agreement, chain: { starts: [start], logs: [] }, secret }, net.connect(), true);
  await settle();

  /**
   * Someone new knocks: their session, at the door (no secret yet), its transport, and what happened ("admitted" once
   * it follows the room's epoch, "denied", or undefined while it waits).
   */
  const knock = async (name: string) => {
    const p: Person = { name, identity: await newIdentity(), agreement: await newAgreement() };
    people.push(p);
    const transport = net.connect();
    const client = await open(p, { agreement: p.agreement, chain: { starts: [], logs: [] } }, transport);
    expect(client.session.knocking).toBe(true);
    await settle();
    const outcome = () =>
      client.session.denied ? "denied" : client.session.knocking ? undefined : ("admitted" as const);
    return { p, client, transport, outcome };
  };

  /** Someone knocks and the host lets them in. */
  const join = async (name: string) => {
    const k = await knock(name);
    expect(await host.client!.session.admit(k.p.identity.key)).toBe(true);
    await settle();
    if (k.outcome() !== "admitted") throw new Error(`${name} wasn't let in`);
    return k.client;
  };
  /** Someone with the link (or a removed member's keys) speaking in the lobby from a transport of their own. */
  let rogues = 0;
  const rogue = async (identity?: Identity, transport = net.connect()) => {
    const id = identity ?? (await newIdentity());
    onTestFinished(() => transport.close());
    const lobby = new Lobby(lobbyKeys, id, seededBytes(90_000 + seed * 100 + ++rogues)(16), clock);
    await settle();
    return {
      id,
      transport,
      lobby,
      async send(body: LobbyBody, to?: string) {
        for (const f of await lobby.seal(body)) transport.send(f, to);
        await settle();
      },
    };
  };
  return { net, clock, link, lobbyKeys, host, people, settle, knock, join, open, rogue, start, secret };
}

const contentFramesTo = (net: MemoryNetwork, peer: string) => {
  const seen: number[] = [];
  const stop = net.tap((r) => {
    if (r.to === peer) seen.push(r.bytes[3]);
  });
  onTestFinished(stop);
  return () => seen.filter((channel) => channel !== 4);
};

describe("knock-to-join", () => {
  it("the link alone only knocks: someone at the door gets none of the room, and can't ask for it", async () => {
    const r = await knockRoom(51);
    const host = r.host.client!;
    const k = await r.knock("wren");
    const content = contentFramesTo(r.net, k.transport.self);
    host.edit((d) => ({ ...d, title: "Members only" }));
    await r.settle();
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(content()).toEqual([]);
    expect(host.session.knocks.has(k.p.identity.key)).toBe(true);
    expect(k.outcome()).toBeUndefined();
    // With the link's keys, a knocker seals a sync request: it doesn't open (the content is under the epoch's own key).
    const sealer = new Sealer(r.lobbyKeys, seededBytes(901)(16));
    k.transport.send(await sealer.seal("doc", frame(DOC.syncRequest, new Uint8Array([0]))));
    await r.settle();
    expect(rejected(host, "auth-failed")).toBe(1);
    expect(content()).toEqual([]);
  });

  it("knock then admit: the newcomer gets the room, and edits go both ways", async () => {
    const r = await knockRoom(52);
    const host = r.host.client!;
    const wren = await r.join("wren");
    expect(title(wren)).toBe(canaryDiagram().title);
    expect(host.session.signed!.state().members.has(wren.session.signed!.key)).toBe(true);
    expect(wren.edit((d) => ({ ...d, title: "From Wren" }))).toBe(true);
    await r.settle();
    expect(title(host)).toBe("From Wren");
  });

  it("knock then deny: the newcomer is told no; a no from someone who isn't the host or a co-host changes nothing", async () => {
    const r = await knockRoom(53);
    const host = r.host.client!;
    const member = await r.join("otter");
    const k = await r.knock("wren");
    // otter, a member but not a co-host, signs a deny: the knocker checks it against the chain, and ignores it.
    const lobby = new Lobby(r.lobbyKeys, r.people[1].identity, seededBytes(902)(16), r.clock);
    for (const f of await lobby.seal({ t: "deny", to: k.p.identity.key, chain: chainOf(host) }))
      member.session.transport.send(f, k.transport.self);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
    host.session.deny(k.p.identity.key);
    await r.settle();
    expect(k.outcome()).toBe("denied");
    expect(k.client.session.status).toBe("left");
    expect(host.session.knocks.size).toBe(0);
  });

  it("a forged admission is refused: a wrapped secret that isn't the epoch's doesn't let anyone in", async () => {
    const r = await knockRoom(54);
    const host = r.host.client!;
    const k = await r.knock("wren");
    // A member (or anyone) hands the knocker a made-up secret on the real chain: the start's commitment refuses it.
    const mallory = { identity: await newIdentity(), agreement: await newAgreement() };
    const lobby = new Lobby(r.lobbyKeys, mallory.identity, seededBytes(903)(16), r.clock);
    const { wrapFor } = await import("./lobby");
    const chain = chainOf(host);
    const wrap = await wrapFor(
      r.lobbyKeys.roomId,
      `0:${chain.starts[0].sig}`,
      mallory,
      { key: k.p.identity.key, x: k.p.agreement.x },
      newEpochSecret(seededBytes(904)),
    );
    for (const f of await lobby.seal({ t: "bundle", chain, wraps: [wrap] }))
      host.session.transport.send(f, k.transport.self);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
  });
});

describe("remove with re-key", () => {
  it("the host removes someone: a new epoch; the others follow with the document; the removed one's old key is refused", async () => {
    const r = await knockRoom(61);
    const host = r.host.client!;
    const wren = await r.join("wren");
    const otter = await r.join("otter");
    otter.edit((d) => ({ ...d, title: "Before" }));
    await r.settle();
    const oldKeys = otter.session.keys;
    expect(await host.session.remove(otter.session.signed!.key)).toBe(true);
    await r.settle();
    expect(host.session.keys.epoch).toBe(1);
    expect(wren.session.keys.epoch).toBe(1);
    expect(otter.session.removed).toBe(true);
    expect(otter.session.status).toBe("left");
    expect(title(wren)).toBe("Before");
    host.edit((d) => ({ ...d, title: "After" }));
    await r.settle();
    expect(title(wren)).toBe("After");
    expect(title(otter)).toBe("Before");
    // The removed one's old key: an edit sealed under it is refused (its epoch is over).
    const rogue = new Sealer(oldKeys, seededBytes(905)(16));
    const t = r.net.connect();
    onTestFinished(() => t.close());
    await r.settle();
    t.send(await rogue.seal("doc", frame(DOC.syncRequest, new Uint8Array([0]))));
    await r.settle();
    expect(rejected(host, "old-epoch")).toBeGreaterThan(0);
    // Nor can it make the new epoch's keys from what it had.
    const guessed = await deriveEpochKeys(r.lobbyKeys, 1, newEpochSecret(seededBytes(906)));
    t.send(await new Sealer(guessed, seededBytes(907)(16)).seal("doc", frame(DOC.syncRequest, new Uint8Array([0]))));
    await r.settle();
    expect(rejected(host, "auth-failed")).toBeGreaterThan(0);
  });
});

describe("knock-to-join: who may do what", () => {
  it("only the host or a co-host lets people in or removes them; a plain member can't", async () => {
    const r = await knockRoom(55);
    const host = r.host.client!;
    const otter = await r.join("otter");
    const k = await r.knock("wren");
    // otter isn't asked (not a host or co-host), and can't admit or remove.
    expect(otter.session.knocks.size).toBe(0);
    const knock = {
      key: k.p.identity.key,
      x: k.p.agreement.x,
      alias: "wren",
      peer: k.transport.self,
      sender: "x",
      at: 0,
    };
    expect(await otter.session.admit(k.p.identity.key, knock)).toBe(false);
    expect(await otter.session.remove(r.host.identity.key)).toBe(false);
    expect(await host.session.remove(r.host.identity.key)).toBe(false);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
    expect(host.session.keys.epoch).toBe(0);
  });

  it("someone holding a leaked secret who wasn't let in isn't a member: their presence and requests are refused", async () => {
    const r = await knockRoom(56);
    const host = r.host.client!;
    const record = host.session.memberRecord()!;
    const mallory: Person = { name: "mallory", identity: await newIdentity(), agreement: await newAgreement() };
    r.people.push(mallory);
    const m = await r.open(
      mallory,
      { agreement: mallory.agreement, chain: record.chain, secret: secretOf(record) },
      r.net.connect(),
    );
    await r.settle();
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(rejected(host, "not-member")).toBeGreaterThan(0);
    expect(host.session.peers().some((p) => p.sender === m.session.senderId)).toBe(false);
    expect(m.session.hasDocument).toBe(false);
  });
});

describe("remove with re-key: edge cases", () => {
  it("someone removed while driving: the host drives in the next epoch", async () => {
    const r = await knockRoom(62);
    const host = r.host.client!;
    const wren = await r.join("wren");
    const otter = await r.join("otter");
    expect(await host.session.appendRoster("drive", { who: otter.session.signed!.key })).toBe(true);
    await r.settle();
    expect(wren.session.signed!.state().driver).toBe(otter.session.signed!.key);
    expect(await host.session.remove(otter.session.signed!.key)).toBe(true);
    await r.settle();
    expect(wren.session.keys.epoch).toBe(1);
    expect(wren.session.signed!.state().driver).toBeUndefined();
  });

  it("Remove is the host's alone: a co-host can't remove anyone; the host removes a co-host (whose roles go with them)", async () => {
    const r = await knockRoom(63);
    const host = r.host.client!;
    const wren = await r.join("wren");
    const otter = await r.join("otter");
    const newt = await r.join("newt");
    expect(await host.session.appendRoster("cohost", { who: wren.session.signed!.key })).toBe(true);
    await r.settle();
    // The co-host lets people in, and much else, but can't remove: nothing is signed, and the room stays put.
    expect(await wren.session.remove(otter.session.signed!.key)).toBe(false);
    await r.settle();
    expect([host, wren, otter, newt].map((c) => c.session.keys.epoch)).toEqual([0, 0, 0, 0]);
    expect(host.session.signed!.state().removal).toBeUndefined();
    expect(await host.session.remove(otter.session.signed!.key)).toBe(true);
    await r.settle();
    expect([host, wren, newt].map((c) => c.session.keys.epoch)).toEqual([1, 1, 1]);
    expect(otter.session.removed).toBe(true);
    expect(await host.session.remove(wren.session.signed!.key)).toBe(true);
    await r.settle();
    expect([host, newt].map((c) => c.session.keys.epoch)).toEqual([2, 2]);
    expect(wren.session.removed).toBe(true);
    expect(host.session.signed!.state().cohosts).toEqual([]);
    // The former co-host's entries don't carry over: one signed for epoch 1 is refused in epoch 2.
    const { signEntry } = await import("./roster");
    const epoch1 = host.session.signed!.knock!.chain.path(host.session.signed!.current!)[1];
    const backdated = await signEntry(wren.session.signed!.identity, r.lobbyKeys.roomId, `1:${epoch1.sig}`, {
      n: 1,
      op: "admit",
      who: wren.session.signed!.key,
      deps: [],
    });
    expect(await host.session.signed!.addEntries([backdated])).toMatchObject({ added: 0 });
  });

  it("three removals attempted at once by different people (each side of a partition): only the host's counts, one line", async () => {
    const r = await knockRoom(64);
    const host = r.host.client!;
    const c1 = await r.join("c1");
    const c2 = await r.join("c2");
    const p = await r.join("p");
    const q = await r.join("q");
    const x = await r.join("x");
    for (const c of [c1, c2])
      expect(await host.session.appendRoster("cohost", { who: c.session.signed!.key })).toBe(true);
    await r.settle();
    const self = (c: TestClient) => c.session.transport.self;
    r.net.partition([
      [self(host), self(x)],
      [self(c1), self(p)],
      [self(c2), self(q)],
    ]);
    await r.settle();
    // Each side removes someone: the host x; the co-hosts p and q (signed as they like, with their own starts).
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    expect(await c1.session.remove(p.session.signed!.key)).toBe(false);
    expect(await c2.session.remove(q.session.signed!.key)).toBe(false);
    const roomId = r.lobbyKeys.roomId;
    for (const [c, who] of [
      [c1, p],
      [c2, q],
    ] as const) {
      const room = c.session.signed!;
      const scope0 = scopeOf(r.start);
      const heads = room.roster.heads();
      const top = Math.max(...heads.map((h) => room.roster.entry(h)!.n));
      const forged = await signEntry(room.identity, roomId, scope0, {
        n: top + 1,
        op: "remove",
        who: who.session.signed!.key,
        deps: heads,
      });
      const secret = newEpochSecret(seededBytes(6400 + top));
      const own = await signStart(room.identity, roomId, {
        epoch: 1,
        kc: await commitEpoch(secret, roomId, 1),
        prev: forged.sig,
      });
      const evil = await r.rogue(room.identity);
      await evil.send({
        t: "bundle",
        chain: { starts: [r.start, own], logs: [{ scope: scope0, entries: [...room.roster.log(), forged] }] },
        wraps: [],
      });
    }
    await r.settle();
    r.net.heal();
    for (let i = 0; i < 4; i++) {
      await r.settle();
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    }
    await r.settle();
    // One line: everyone left is in epoch 1, the host's, with the same scope; only x is out.
    const epoch1 = host.session.signed!.current!;
    expect(epoch1.epoch).toBe(1);
    expect(epoch1.by).toBe(r.host.identity.key);
    for (const c of [c1, c2, p, q]) {
      expect(c.session.removed).toBe(false);
      expect(c.session.signed!.current!.sig).toBe(epoch1.sig);
      expect(c.session.keys.epoch).toBe(1);
      expect(c.session.signed!.knock!.chain.validated()).toHaveLength(2);
    }
    expect(x.session.removed).toBe(true);
    host.edit((d) => ({ ...d, title: "One room" }));
    await r.settle();
    for (const c of [c1, c2, p, q]) expect(title(c)).toBe("One room");
    q.edit((d) => ({ ...d, title: "From q" }));
    await r.settle();
    for (const c of [host, c1, c2, p]) expect(title(c)).toBe("From q");
  }, 20_000);

  it("someone other than the host drives; the host removes a third person: the driver stays the driver throughout", async () => {
    const r = await knockRoom(91);
    const host = r.host.client!;
    const d = await r.join("d");
    const x = await r.join("x");
    expect(await host.session.appendRoster("drive", { who: d.session.signed!.key })).toBe(true);
    await r.settle();
    const watch = new WatchTogether(
      host.session,
      new RoomRoster({ member: "0123456789abcdef", hosting: true, cohosts: [] }, () => {}),
      { read: () => ({ documentId: "room-a", eligible: true }), show: () => {}, subscribe: () => () => {} },
      { offer: () => {}, told: () => {} },
    );
    onTestFinished(() => watch.dispose());
    const driverNow = () => (watch as unknown as { rosterNow(): { driver?: string } }).rosterNow().driver;
    expect(driverNow()).toBe(d.session.senderId);
    // Every moment anyone could look: each change to the room's bindings or roster, and to the session.
    const seen = new Set<string | undefined>();
    const driving = new Set<boolean>();
    const look = () => {
      seen.add(driverNow());
      driving.add(watch.getState().driving);
    };
    const stops = [host.session.signed!.subscribe(look), host.session.onChange(look), watch.subscribe(look)];
    onTestFinished(() => stops.forEach((stop) => stop()));
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    for (let i = 0; i < 3; i++) {
      await r.settle();
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    }
    await r.settle();
    expect(host.session.keys.epoch).toBe(1);
    expect(seen.size).toBeGreaterThan(0);
    expect([...seen]).toEqual([d.session.senderId]);
    expect([...driving]).toEqual([false]);
  });

  it("a re-key while a newcomer is still joining: they follow to the new epoch", async () => {
    const r = await knockRoom(65);
    const host = r.host.client!;
    const otter = await r.join("otter");
    const k = await r.knock("wren");
    // The host lets wren in, and removes otter, before wren has taken the first.
    expect(await host.session.admit(k.p.identity.key)).toBe(true);
    expect(await host.session.remove(otter.session.signed!.key)).toBe(true);
    await r.settle();
    expect(k.outcome()).toBe("admitted");
    expect(k.client.session.keys.epoch).toBe(1);
    expect(title(k.client)).toBe(canaryDiagram().title);
  });

  it("let in at the same moment as a removal elsewhere (not in the next epoch): they're let back in", async () => {
    const r = await knockRoom(67);
    const host = r.host.client!;
    const cohost = await r.join("cohost");
    const otter = await r.join("otter");
    expect(await host.session.appendRoster("cohost", { who: cohost.session.signed!.key })).toBe(true);
    await r.settle();
    const k = await r.knock("wren");
    // The co-host lets wren in while the host removes otter: neither saw the other's entry first.
    const admitted = cohost.session.admit(k.p.identity.key);
    const removed = host.session.remove(otter.session.signed!.key);
    expect(await admitted).toBe(true);
    expect(await removed).toBe(true);
    for (let i = 0; i < 4; i++) {
      await r.settle();
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    }
    await r.settle();
    expect(otter.session.removed).toBe(true);
    expect(k.outcome()).toBe("admitted");
    expect(k.client.session.keys.epoch).toBe(host.session.keys.epoch);
    host.edit((d) => ({ ...d, title: "All here" }));
    await r.settle();
    expect(title(k.client)).toBe("All here");
  });

  it("past sixteen removals, a member's reload comes back to the room and a newcomer is still let in", async () => {
    const r = await knockRoom(87);
    const host = r.host.client!;
    const wren = await r.join("wren");
    for (let i = 0; i < 17; i++) {
      const goes = await r.join(`goes${i}`);
      expect(await host.session.remove(goes.session.signed!.key)).toBe(true);
      await r.settle();
    }
    expect(host.session.keys.epoch).toBe(17);
    expect(wren.session.keys.epoch).toBe(17);
    const record = wren.session.memberRecord()!;
    expect(record.chain.starts).toHaveLength(18);
    await wren.session.leave();
    await r.settle();
    host.edit((d) => ({ ...d, title: "Epoch 17" }));
    await r.settle();
    const wrenP = r.people[1];
    const back = await r.open(
      wrenP,
      { agreement: wrenP.agreement, chain: record.chain, secret: secretOf(record), wraps: record.wraps },
      r.net.connect(),
    );
    await r.settle();
    expect(back.session.knocking).toBe(false);
    expect(back.session.keys.epoch).toBe(17);
    expect(title(back)).toBe("Epoch 17");
    const otter = await r.join("otter");
    expect(otter.session.keys.epoch).toBe(17);
    expect(title(otter)).toBe("Epoch 17");
  }, 60_000);

  it("at the last epoch, Remove changes nothing (nothing signed, nobody re-keyed) and the host is told to start a new room", async () => {
    const r = await knockRoom(93);
    const host = r.host.client!;
    const stays = await r.join("stays");
    for (let i = 0; i < MAX_EPOCHS - 1; i++) {
      const goes = await r.join(`goes${i}`);
      expect(await host.session.remove(goes.session.signed!.key)).toBe(true);
      await r.settle();
    }
    expect(host.session.keys.epoch).toBe(MAX_EPOCHS - 1);
    expect(host.session.atRemovalLimit).toBe(true);
    const last = await r.join("last");
    const before = host.session.signed!.roster.log().length;
    expect(await host.session.remove(last.session.signed!.key)).toBe(false);
    await r.settle();
    // Nothing recorded or sent: no removal in the roster (it would block every later one), the same keys everywhere.
    expect(host.session.signed!.roster.log()).toHaveLength(before);
    expect(host.session.signed!.state().removal).toBeUndefined();
    for (const c of [host, stays, last]) {
      expect(c.session.keys.epoch).toBe(MAX_EPOCHS - 1);
      expect(c.session.removed).toBe(false);
      expect(c.session.signed!.state().members.has(last.session.signed!.key)).toBe(true);
    }
    // From the people menu: told plainly, and still nothing signed.
    const told: string[] = [];
    const watch = new WatchTogether(
      host.session,
      new RoomRoster({ member: "0123456789abcdef", hosting: true, cohosts: [] }, () => {}),
      { read: () => ({ documentId: "room-a", eligible: true }), show: () => {}, subscribe: () => () => {} },
      { offer: () => {}, told: (m) => told.push(m) },
    );
    onTestFinished(() => watch.dispose());
    watch.remove(last.session.senderId);
    await r.settle();
    expect(told).toEqual(["removal-limit"]);
    expect(host.session.signed!.roster.log()).toHaveLength(before);
  }, 60_000);

  it("every full-capacity chain piece seals into one lobby frame, then converges in any order", async () => {
    const r = await knockRoom(94);
    const host = r.host.client!;
    const m = await r.join("m");
    const rounds = async (n: number) => {
      for (let i = 0; i < n; i++) {
        r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
        await r.settle();
      }
    };
    // Three co-hosts who aren't here (the roster's entries are what's being carried, not their pages).
    const cohosts: Identity[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await newIdentity();
      cohosts.push(id);
      expect(await host.session.appendRoster("join", { who: id.key, x: (await newAgreement()).x })).toBe(true);
      expect(await host.session.appendRoster("cohost", { who: id.key })).toBe(true);
    }
    await r.settle();
    // An epoch's roster as full as a room's can be: the host's share (all but what its join and removal need) and the
    // co-hosts' (the rest of the room's entries), each one counted.
    const fill = async () => {
      const room = host.session.signed!;
      const roster = room.roster;
      const mine = () => roster.log().filter((e) => e.by === room.key).length;
      let flip = !roster.state().ask;
      while (mine() < MAX_ENTRIES_PER_SIGNER - 3) {
        expect(await room.append("ask", { ask: flip })).toBeDefined();
        flip = !flip;
      }
      for (const id of cohosts)
        for (let i = 0; i < 250; i++) {
          expect(await roster.append(id, "ask", { ask: flip })).toBeDefined();
          flip = !flip;
        }
      if (!roster.state().ask) expect(await room.append("ask", { ask: true })).toBeDefined();
      expect(roster.size).toBeGreaterThanOrEqual(1_000);
    };
    // Each epoch closed by removing someone who isn't here (let in, and away): the wraps cover them all the same.
    const removeSomeone = async () => {
      const away = await newIdentity();
      expect(await host.session.signed!.append("join", { who: away.key, x: (await newAgreement()).x })).toBeDefined();
      return away;
    };
    for (let i = 0; i < MAX_EPOCHS - 1; i++) {
      await fill();
      const away = await removeSomeone();
      if (i === 20) {
        // Sealing a later piece fails (the chain is in pieces by now): nothing is kept, sent or re-keyed; then a retry.
        const before = {
          log: host.session.signed!.roster.log().length,
          starts: host.session.signed!.knock!.chain.validated().length,
          epoch: host.session.keys.epoch,
          wraps: (host.session as unknown as { wraps: unknown[] }).wraps.length,
        };
        const lobby = (host.session as unknown as { lobby: Lobby }).lobby;
        const seal = lobby.seal.bind(lobby);
        let calls = 0;
        lobby.seal = async (body) => {
          if (body.t === "bundle" && ++calls === 2) throw new Error("sealing failed");
          return seal(body);
        };
        let sent = 0;
        const stop = r.net.tap((rec) => {
          if (rec.from === host.session.transport.self && rec.bytes[3] === 4) sent++;
        });
        expect(await host.session.remove(away.key)).toBe(false);
        await r.settle();
        stop();
        lobby.seal = seal;
        expect(calls).toBeGreaterThanOrEqual(2);
        expect(sent).toBe(0);
        expect({
          log: host.session.signed!.roster.log().length,
          starts: host.session.signed!.knock!.chain.validated().length,
          epoch: host.session.keys.epoch,
          wraps: (host.session as unknown as { wraps: unknown[] }).wraps.length,
        }).toEqual(before);
        expect(host.session.signed!.state().removal).toBeUndefined();
      }
      expect(await host.session.remove(away.key)).toBe(true);
      await rounds(3);
      expect(m.session.keys.epoch).toBe(i + 1);
    }
    const data = host.session.signed!.knock!.chain.data(host.session.signed!.current);
    expect(data.starts).toHaveLength(MAX_EPOCHS);
    expect(JSON.stringify(data).length).toBeGreaterThan(MAX_LOBBY_MESSAGE_BYTES);
    const current = host.session.signed!.current!;
    const secret = host.session.signed!.knock!.chain.secretOf(current)!;
    const wraps = await Promise.all(
      Array.from({ length: 64 }, async () => {
        const identity = await newIdentity();
        const agreement = await newAgreement();
        return wrapFor(r.lobbyKeys.roomId, scopeOf(current), r.host, { key: identity.key, x: agreement.x }, secret);
      }),
    );
    const pieces = chainMessages(data, wraps);
    const lobby = (host.session as unknown as { lobby: Lobby }).lobby;
    for (const piece of pieces) {
      const frames = await lobby.seal(piece);
      expect(frames).toHaveLength(1);
      expect(frames[0].byteLength).toBeLessThanOrEqual(COLLAB_LIMITS.maxDocFrameBytes);
    }
    expect(pieces.at(-1)!.wraps).toHaveLength(64);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(textToBytes(JSON.stringify(piece)).length).toBeLessThan(MAX_LOBBY_MESSAGE_BYTES);
    host.edit((d) => ({ ...d, title: "Thirty-one" }));
    await r.settle();
    expect(title(m)).toBe("Thirty-one");
    // From here, every frame in any order: someone new let in, someone else told no.
    r.net.setFaults({ reorder: true });
    const k = await r.knock("newt");
    const no = await r.knock("nope");
    expect(await host.session.admit(k.p.identity.key)).toBe(true);
    host.session.deny(no.p.identity.key);
    for (let i = 0; i < 80 && (k.outcome() !== "admitted" || no.outcome() !== "denied"); i++) await rounds(1);
    expect(k.outcome()).toBe("admitted");
    expect(no.outcome()).toBe("denied");
    expect(k.client.session.keys.epoch).toBe(MAX_EPOCHS - 1);
    await rounds(2);
    expect(title(k.client)).toBe("Thirty-one");
  }, 600_000);

  it("a member away during a re-key comes back (an old record) and follows; someone removed who comes back is told", async () => {
    const r = await knockRoom(66);
    const host = r.host.client!;
    const wren = await r.join("wren");
    const otter = await r.join("otter");
    const wrenRecord = wren.session.memberRecord()!;
    const otterRecord = otter.session.memberRecord()!;
    await wren.session.leave();
    await r.settle();
    expect(await host.session.remove(otter.session.signed!.key)).toBe(true);
    await r.settle();
    host.edit((d) => ({ ...d, title: "While away" }));
    await r.settle();
    const [wrenP, otterP] = [r.people[1], r.people[2]];
    const back = await r.open(
      wrenP,
      { agreement: wrenP.agreement, chain: wrenRecord.chain, secret: secretOf(wrenRecord), wraps: wrenRecord.wraps },
      r.net.connect(),
    );
    await r.settle();
    expect(back.session.keys.epoch).toBe(1);
    expect(title(back)).toBe("While away");
    const again = await r.open(
      otterP,
      {
        agreement: otterP.agreement,
        chain: otterRecord.chain,
        secret: secretOf(otterRecord),
        wraps: otterRecord.wraps,
      },
      r.net.connect(),
    );
    await r.settle();
    expect(again.session.removed).toBe(true);
    expect(title(again)).not.toBe("While away");
  });
});

const secretOf = (rec: { secret: string }) => base64UrlToBytes(rec.secret);

describe("knock-to-join and re-key, against someone who doesn't follow the rules", () => {
  it("a removed co-host can't roll the room back (an earlier removal in a closed epoch, a start of its own); no nonce is used twice", async () => {
    const r = await knockRoom(71);
    const host = r.host.client!;
    const rco = await r.join("rco");
    const m = await r.join("m");
    expect(await host.session.appendRoster("cohost", { who: rco.session.signed!.key })).toBe(true);
    await r.settle();
    // Every content frame m sends, by recipient, epoch, sender, channel and counter: none twice (a key and nonce reused).
    const seen = new Set<string>();
    let repeats = 0;
    const stop = r.net.tap((rec) => {
      if (rec.from !== m.session.transport.self || rec.bytes[3] === 4) return;
      const header = Array.from(rec.bytes.subarray(3, 32)).join(",");
      const key = `${rec.to}:${header}`;
      if (seen.has(key)) repeats++;
      seen.add(key);
    });
    onTestFinished(stop);
    m.session.setSelection(["gateway"]);
    await r.settle();
    const held = rco.session.memberRecord()!;
    const cohostEntry = held.chain.logs[0].entries.find((e) => (e as { op: string }).op === "cohost") as {
      sig: string;
      n: number;
    };
    // The host's removal comes later in the roster's order than anything the co-host can backdate.
    expect(await host.session.appendRoster("drive", { who: m.session.signed!.key })).toBe(true);
    expect(await host.session.remove(rco.session.signed!.key)).toBe(true);
    await r.settle();
    const epoch1 = m.session.signed!.current!;
    expect(epoch1.epoch).toBe(1);
    // The removed co-host signs a removal of m in epoch 0 (its authority there checks), sorting first, and an epoch of
    // its own after it, with a secret it knows, wrapped for m.
    const scope0 = `0:${held.chain.starts[0].sig}`;
    const backdated = await signEntry(rco.session.signed!.identity, r.lobbyKeys.roomId, scope0, {
      n: cohostEntry.n + 1,
      op: "remove",
      who: m.session.signed!.key,
      deps: [cohostEntry.sig],
    });
    const known = newEpochSecret(seededBytes(7101));
    const own = await signStart(rco.session.signed!.identity, r.lobbyKeys.roomId, {
      epoch: 1,
      kc: await commitEpoch(known, r.lobbyKeys.roomId, 1),
      prev: backdated.sig,
    });
    const agreement = rco.session.signed!.knock!.agreement;
    const wrap = await wrapFor(
      r.lobbyKeys.roomId,
      scopeOf(own),
      { identity: rco.session.signed!.identity, agreement },
      { key: m.session.signed!.key, x: m.session.signed!.knock!.agreement.x },
      known,
    );
    const evil = await r.rogue(rco.session.signed!.identity);
    const logs = [{ scope: scope0, entries: [...held.chain.logs[0].entries, backdated] }];
    // The removal alone (the epoch it closed falls back to an ancestor on a naive chain), then with its own start.
    await evil.send({ t: "bundle", chain: { starts: held.chain.starts, logs }, wraps: [] });
    await evil.send({
      t: "bundle",
      chain: { starts: [...held.chain.starts, own], logs: [...logs, { scope: scopeOf(own), entries: [] }] },
      wraps: [wrap],
    });
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    for (const c of [host, m]) {
      expect(c.session.signed!.current!.sig).toBe(epoch1.sig);
      expect(c.session.keys.epoch).toBe(1);
      expect(c.session.removed).toBe(false);
    }
    host.edit((d) => ({ ...d, title: "Still epoch 1" }));
    m.session.setSelection(["orders"]);
    await r.settle();
    expect(title(m)).toBe("Still epoch 1");
    expect(repeats).toBe(0);
  });

  it("a removed co-host's backdated join in an epoch it once led lets nobody in: the newcomer still knocks and waits", async () => {
    const r = await knockRoom(84);
    const host = r.host.client!;
    const rco = await r.join("rco");
    await r.join("m");
    expect(await host.session.appendRoster("cohost", { who: rco.session.signed!.key })).toBe(true);
    await r.settle();
    const held = rco.session.memberRecord()!;
    const cohostEntry = held.chain.logs[0].entries.find((e) => (e as { op: string }).op === "cohost") as {
      sig: string;
      n: number;
    };
    expect(await host.session.remove(rco.session.signed!.key)).toBe(true);
    await r.settle();
    expect(host.session.keys.epoch).toBe(1);
    // The removed co-host signs a join for an identity of its own in epoch 0, where its authority checks.
    const fresh = { identity: await newIdentity(), agreement: await newAgreement() };
    const scope0 = `0:${held.chain.starts[0].sig}`;
    const backdated = await signEntry(rco.session.signed!.identity, r.lobbyKeys.roomId, scope0, {
      n: cohostEntry.n + 1,
      op: "join",
      who: fresh.identity.key,
      x: fresh.agreement.x,
      deps: [cohostEntry.sig],
    });
    const evil = await r.rogue(rco.session.signed!.identity);
    await evil.send({
      t: "bundle",
      chain: {
        starts: held.chain.starts,
        logs: [{ scope: scope0, entries: [...held.chain.logs[0].entries, backdated] }],
      },
      wraps: [],
    });
    // The backdated join counts in epoch 0's roster (it's well signed), and grants nothing now.
    const chain = host.session.signed!.knock!.chain;
    expect(chain.rosterOf(r.start)!.joinsOf(fresh.identity.key)).toHaveLength(1);
    const p = { name: "fresh", ...fresh };
    r.people.push(p);
    const transport = r.net.connect();
    const client = await r.open(p, { agreement: p.agreement, chain: { starts: [], logs: [] } }, transport);
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(client.session.knocking).toBe(true);
    expect(host.session.knocks.has(fresh.identity.key)).toBe(true);
    expect(host.session.signed!.state().members.has(fresh.identity.key)).toBe(false);
    expect(client.session.hasDocument).toBe(false);
    // The host answers: now it's in.
    expect(await host.session.admit(fresh.identity.key)).toBe(true);
    await r.settle();
    expect(client.session.knocking).toBe(false);
    expect(client.session.keys.epoch).toBe(1);
  });

  it("someone removed and let back in doesn't stop a later removal: everyone left reaches one epoch, edits and Live", async () => {
    const r = await knockRoom(85);
    const host = r.host.client!;
    const a = await r.join("a");
    const b = await r.join("b");
    const c = await r.join("c");
    const aKey = a.session.signed!.key;
    expect(await host.session.remove(aKey)).toBe(true);
    await r.settle();
    const aP = r.people[1];
    const again = await r.open(aP, { agreement: aP.agreement, chain: { starts: [], logs: [] } }, r.net.connect());
    await r.settle();
    expect(await host.session.admit(aKey)).toBe(true);
    await r.settle();
    expect(again.session.knocking).toBe(false);
    expect(await host.session.remove(b.session.signed!.key)).toBe(true);
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(b.session.removed).toBe(true);
    const epoch2 = host.session.signed!.current!;
    expect(epoch2.epoch).toBe(2);
    for (const x of [again, c]) {
      expect(x.session.removed).toBe(false);
      expect(x.session.signed!.current!.sig).toBe(epoch2.sig);
      expect(x.session.keys.epoch).toBe(2);
    }
    host.edit((d) => ({ ...d, title: "From the host" }));
    await r.settle();
    expect(title(again)).toBe("From the host");
    expect(title(c)).toBe("From the host");
    again.edit((d) => ({ ...d, title: "From a" }));
    await r.settle();
    expect(title(host)).toBe("From a");
    expect(title(c)).toBe("From a");
    const heard: string[] = [];
    for (const [name, x] of [
      ["host", host],
      ["a", again],
      ["c", c],
    ] as const)
      onTestFinished(x.session.onLive(() => heard.push(name)));
    expect(host.session.sendLive(textToBytes("{}"))).toBe(true);
    expect(c.session.sendLive(textToBytes("{}"))).toBe(true);
    await r.settle();
    expect(heard.filter((n) => n === "a")).toHaveLength(2);
    expect(heard.filter((n) => n === "c")).toHaveLength(1);
    expect(heard.filter((n) => n === "host")).toHaveLength(1);
  });

  it("a former or removed co-host's removal is refused whenever it arrives: before the host's start, after it, or on reload", async () => {
    const r = await knockRoom(90);
    const host = r.host.client!;
    const co = await r.join("co");
    const m = await r.join("m");
    const x = await r.join("x");
    const roomId = r.lobbyKeys.roomId;
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const coId = co.session.signed!.identity;
    // What the co-host signs while it co-hosts: a removal of m in this epoch, and an epoch of its own after it.
    const forge = async (start: EpochStart, epoch: number, seed: number) => {
      const roster = co.session.signed!.knock!.chain.rosterOf(start)!;
      const heads = roster.heads();
      const removal = await signEntry(coId, roomId, scopeOf(start), {
        n: Math.max(...heads.map((h) => roster.entry(h)!.n)) + 1,
        op: "remove",
        who: m.session.signed!.key,
        deps: heads,
      });
      const secret = newEpochSecret(seededBytes(seed));
      const own = await signStart(coId, roomId, {
        epoch: epoch + 1,
        kc: await commitEpoch(secret, roomId, epoch + 1),
        prev: removal.sig,
      });
      const chain = co.session.signed!.knock!.chain.data(start);
      chain.starts.push(own);
      chain.logs.at(-1)!.entries.push(removal);
      chain.logs.push({ scope: scopeOf(own), entries: [] });
      return chain;
    };
    const forged0 = await forge(r.start, 0, 9001);
    // A former co-host: demoted, then its removal sent (before the host's start).
    expect(await host.session.appendRoster("uncohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const evil = await r.rogue(coId);
    await evil.send({ t: "bundle", chain: forged0, wraps: [] });
    for (const c of [host, m]) {
      expect(c.session.keys.epoch).toBe(0);
      expect(c.session.signed!.knock!.chain.validated()).toHaveLength(1);
      expect(c.session.signed!.state().removal).toBeUndefined();
    }
    // The host's removal: one line, the host's.
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    await r.settle();
    const epoch1 = host.session.signed!.current!;
    expect(m.session.signed!.current!.sig).toBe(epoch1.sig);
    // After the host's start: the same removal changes nothing.
    await evil.send({ t: "bundle", chain: forged0, wraps: [] });
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    for (const c of [host, m, co]) {
      expect(c.session.removed).toBe(false);
      expect(c.session.signed!.current!.sig).toBe(epoch1.sig);
    }
    // A removed co-host: made co-host again, then removed; its removal in the epoch it co-hosted refused too.
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const forged1 = await forge(epoch1, 1, 9002);
    const extra = await r.join("extra");
    expect(await host.session.remove(co.session.signed!.key)).toBe(true);
    await r.settle();
    const epoch2 = host.session.signed!.current!;
    expect(epoch2.epoch).toBe(2);
    await evil.send({ t: "bundle", chain: forged1, wraps: [] });
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    for (const c of [host, m, extra]) {
      expect(c.session.removed).toBe(false);
      expect(c.session.signed!.current!.sig).toBe(epoch2.sig);
    }
    // On reload: m's record, with every forged entry and start in it, comes back to the same epoch.
    const record = m.session.memberRecord()!;
    const chain = {
      starts: [...record.chain.starts, forged0.starts.at(-1)!, forged1.starts.at(-1)!],
      logs: record.chain.logs.map((l) =>
        l.scope === scopeOf(r.start)
          ? { ...l, entries: [...l.entries, forged0.logs[0].entries.at(-1)!] }
          : l.scope === scopeOf(epoch1)
            ? { ...l, entries: [...l.entries, forged1.logs.at(-2)!.entries.at(-1)!] }
            : l,
      ),
    };
    await m.session.leave();
    await r.settle();
    const mP = r.people[2];
    const back = await r.open(
      mP,
      { agreement: mP.agreement, chain, secret: secretOf(record), scope: record.scope, wraps: record.wraps },
      r.net.connect(),
    );
    await r.settle();
    expect(back.session.signed!.current!.sig).toBe(epoch2.sig);
    expect(back.session.signed!.knock!.chain.validated().map((st) => st.sig)).toEqual(
      host.session.signed!.knock!.chain.validated().map((st) => st.sig),
    );
    host.edit((d) => ({ ...d, title: "After it all" }));
    await r.settle();
    expect(title(back)).toBe("After it all");
  });

  it("starts from someone with only the link take no room: a removal after them still moves the room on", async () => {
    const r = await knockRoom(72);
    const host = r.host.client!;
    const stays = await r.join("stays");
    const goes = await r.join("goes");
    const evil = await r.rogue();
    const roomId = r.lobbyKeys.roomId;
    const junk = [];
    for (let i = 0; i < 64; i++)
      junk.push(
        await signStart(evil.id, roomId, { epoch: 0, kc: "A".repeat(43), x: stays.session.signed!.knock!.agreement.x }),
      );
    for (let i = 1; i < 20; i++)
      junk.push(await signStart(evil.id, roomId, { epoch: i, kc: "A".repeat(43), prev: r.start.sig }));
    // In bundles a lobby takes (64 starts at most each): every one reaches the chain, and none takes a place.
    for (const starts of [junk.slice(0, 64), junk.slice(64)]) {
      const bundle = { t: "bundle" as const, chain: { starts, logs: [] }, wraps: [] };
      expect(parseBody(JSON.parse(JSON.stringify(bundle)))).toBeDefined();
      for (const st of starts) expect(parseStart(st)).toBeDefined();
      await evil.send(bundle);
      expect(host.session.signed!.knock!.chain.validated()).toHaveLength(1);
    }
    expect(await host.session.remove(goes.session.signed!.key)).toBe(true);
    await r.settle();
    expect(stays.session.keys.epoch).toBe(1);
    expect(goes.session.removed).toBe(true);
  });

  it("starts that can't be placed cost bounded work, however many epochs they claim", async () => {
    const r = await knockRoom(73);
    const host = r.host.client!;
    await r.join("wren");
    const evil = await r.rogue();
    const roomId = r.lobbyKeys.roomId;
    // Valid signatures of nothing here: well-formed predecessors (86 characters, canonical) that no roster holds.
    let n = 0;
    const sig = () => bytesToBase64Url(seededBytes(7300 + ++n)(64));
    const starts = [];
    for (let epoch = 1; epoch < 32; epoch++)
      for (let i = 0; i < 2; i++)
        starts.push(await signStart(evil.id, roomId, { epoch, kc: "A".repeat(43), prev: sig() }));
    for (const st of starts) expect(parseStart(st)).toBeDefined();
    const chain = host.session.signed!.knock!.chain;
    const before = chain.work.lookups;
    await evil.send({ t: "bundle", chain: { starts: starts.slice(0, 62), logs: [] }, wraps: [] });
    expect(chain.work.lookups).toBeGreaterThan(before);
    expect(chain.validated()).toHaveLength(1);
  }, 20_000);

  it("unplaceable starts perform nonzero bounded resolution work: counted, within what the pool and the chain allow", async () => {
    const r = await knockRoom(86);
    const host = r.host.client!;
    await r.join("wren");
    const chain = host.session.signed!.knock!.chain;
    const roomId = r.lobbyKeys.roomId;
    const sig = (n: number) => bytesToBase64Url(seededBytes(8600 + n)(64));
    // Each sender a bundle of unplaceable starts (a parent's removal that's nowhere), claiming `epochs` epochs.
    const flood = async (epochs: number) => {
      const evil = await r.rogue();
      const starts = [];
      for (let epoch = 1; epoch <= epochs; epoch++)
        for (let i = 0; i < 2; i++)
          starts.push(
            await signStart(evil.id, roomId, { epoch, kc: "A".repeat(43), prev: sig(epochs * 100 + epoch * 2 + i) }),
          );
      for (const st of starts) expect(parseStart(st)).toBeDefined();
      const before = chain.work.lookups;
      await evil.send({ t: "bundle", chain: { starts, logs: [] }, wraps: [] });
      return chain.work.lookups - before;
    };
    const few = await flood(4);
    const all = await flood(31);
    expect(chain.validated()).toHaveLength(1);
    // Each resolution looks at no more than the waiting pool (16) against the chain's starts, once per epoch: never
    // the product of what was claimed.
    const bound = 16 * chain.validated().length * MAX_EPOCHS * 2;
    expect(few).toBeGreaterThan(0);
    expect(all).toBeGreaterThan(0);
    expect(few).toBeLessThanOrEqual(bound);
    expect(all).toBeLessThanOrEqual(bound);
  }, 20_000);

  it("a forged wrap (claiming the host wrapped it) doesn't stop the host's own from letting the newcomer in", async () => {
    const r = await knockRoom(74);
    const host = r.host.client!;
    const k = await r.knock("wren");
    const evil = await r.rogue();
    const agreement = await newAgreement();
    const scope0 = scopeOf(r.start);
    const real = await wrapFor(
      r.lobbyKeys.roomId,
      scope0,
      { identity: evil.id, agreement },
      { key: k.p.identity.key, x: k.p.agreement.x },
      newEpochSecret(seededBytes(7401)),
    );
    const forged = { ...real, from: r.host.identity.key };
    await evil.send({ t: "bundle", chain: chainOf(host), wraps: [forged] }, k.transport.self);
    expect(k.outcome()).toBeUndefined();
    expect(await host.session.admit(k.p.identity.key)).toBe(true);
    await r.settle();
    expect(k.outcome()).toBe("admitted");
  });

  it("a lobby frame replayed under a higher counter, or tampered with, is refused, and the sender's own frames still count", async () => {
    const r = await knockRoom(75);
    const host = r.host.client!;
    let captured: Uint8Array | undefined;
    const stop = r.net.tap((rec) => {
      // The knocker's first knock, as the host receives it.
      if (!captured && rec.bytes[3] === 4 && rec.to === host.session.transport.self) captured = rec.bytes;
    });
    const k = await r.knock("wren");
    stop();
    expect(captured).toBeDefined();
    const plain = await new Opener(r.lobbyKeys, seededBytes(7501)(16)).open(captured!, true);
    if (!plain.ok) throw new Error("couldn't open the captured frame");
    const sender = captured!.slice(8, 24);
    const attacker = r.net.connect();
    onTestFinished(() => attacker.close());
    // The same message (its signature with it) under a far higher counter, from another transport peer: its sender id
    // is the knocker's peer's, so it's refused before anything is decrypted.
    const replayer = new Sealer(r.lobbyKeys, sender);
    (replayer as unknown as { counters: { lobby: number } }).counters.lobby = 1_000_000;
    attacker.send(await replayer.seal("lobby", plain.plaintext), host.session.transport.self);
    await r.settle();
    expect(rejected(host, "too-many-senders")).toBe(1);
    // From the knocker's own transport peer (someone relaying it, say), it reaches the signature check.
    (replayer as unknown as { counters: { lobby: number } }).counters.lobby = 1_500_000;
    k.transport.send(await replayer.seal("lobby", plain.plaintext), host.session.transport.self);
    // Its message changed by a byte (re-sealed properly, so it reaches the signature check).
    const tampered = plain.plaintext.slice();
    tampered[5] ^= 1;
    (replayer as unknown as { counters: { lobby: number } }).counters.lobby = 2_000_000;
    k.transport.send(await replayer.seal("lobby", tampered), host.session.transport.self);
    await r.settle();
    expect(rejected(host, "bad-signature")).toBe(2);
    // The knocker's own next knocks still count (nothing moved its window).
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(rejected(host, "stale")).toBe(0);
    expect(rejected(host, "replay")).toBe(0);
    expect(host.session.knocks.has(k.p.identity.key)).toBe(true);
  });

  it("knocks are bounded: one per transport peer (a new key replaces its last), a few in all, and old ones go", async () => {
    const r = await knockRoom(76);
    const host = r.host.client!;
    const shared = r.net.connect();
    for (let i = 0; i < 20; i++) {
      const evil = await r.rogue(undefined, shared);
      await evil.send({ t: "hello", x: (await newAgreement()).x, alias: `Evil ${i}` });
    }
    expect(host.session.knocks.size).toBe(1);
    for (let i = 0; i < 12; i++) {
      const evil = await r.rogue();
      await evil.send({ t: "hello", x: (await newAgreement()).x, alias: `Many ${i}` });
    }
    expect(host.session.knocks.size).toBeLessThanOrEqual(8);
    // Not said again: they go.
    for (let i = 0; i < 14; i++) r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(host.session.knocks.size).toBe(0);
  });

  it("lobby frames under endless sender ids with bad signatures cost their peer's budget and leave nothing behind", async () => {
    const r = await knockRoom(88);
    const host = r.host.client!;
    const lobbyOf = (c: TestClient) => (c.session as unknown as { lobby: Lobby }).lobby;
    const transport = r.net.connect();
    onTestFinished(() => transport.close());
    const [mine, other] = [await newIdentity(), await newIdentity()];
    // Signed by one key, claiming another: every frame's signature fails.
    const liar = { ...mine, key: other.key };
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 1_000; i++) {
      const lobby = new Lobby(r.lobbyKeys, liar, seededBytes(88_000 + i)(16), r.clock);
      frames.push(...(await lobby.seal({ t: "hello", x: (await newAgreement()).x, alias: `Liar ${i}` })));
    }
    await r.settle();
    for (const f of frames) transport.send(f, host.session.transport.self);
    await r.settle();
    // At most the peer's budget was decrypted and checked; the rest was refused before anything was.
    expect(rejected(host, "bad-signature")).toBeLessThanOrEqual(512);
    expect(rejected(host, "lobby-throttled")).toBeGreaterThanOrEqual(1_000 - 512);
    expect(lobbyOf(host).load()).toMatchObject({ members: 0, guests: 0, buckets: 0 });
    // Someone real still knocks, and is let in.
    r.clock.advance(COLLAB_LIMITS.senderWindowMs);
    const k = await r.knock("wren");
    expect(host.session.knocks.has(k.p.identity.key)).toBe(true);
    expect(await host.session.admit(k.p.identity.key)).toBe(true);
    await r.settle();
    expect(k.outcome()).toBe("admitted");
  });

  it("someone with the link can't take members' places: a few sender ids per peer, a pool for the door, freed when they go", async () => {
    const r = await knockRoom(89);
    const host = r.host.client!;
    const lobbyOf = (c: TestClient) => (c.session as unknown as { lobby: Lobby }).lobby;
    const wren = await r.join("wren");
    const record = wren.session.memberRecord()!;
    // One key, one transport peer, 64 sender ids: two get places.
    const shared = r.net.connect();
    const id = await newIdentity();
    for (let i = 0; i < 64; i++) {
      const evil = await r.rogue(id, shared);
      await evil.send({ t: "hello", x: (await newAgreement()).x, alias: `Same ${i}` }, host.session.transport.self);
    }
    expect(lobbyOf(host).load().guests).toBeLessThanOrEqual(2);
    expect(rejected(host, "too-many-senders")).toBeGreaterThanOrEqual(62);
    // Many peers at the door: their pool is bounded, and never takes members' places.
    const many: CollabTransport[] = [];
    for (let i = 0; i < 40; i++) {
      const t = r.net.connect();
      many.push(t);
      const evil = await r.rogue(undefined, t);
      await evil.send({ t: "hello", x: (await newAgreement()).x, alias: `Many ${i}` }, host.session.transport.self);
    }
    expect(lobbyOf(host).load().guests).toBeLessThanOrEqual(32);
    r.clock.advance(KNOCK_TTL_MS + 1_000);
    await r.settle();
    // A member reloads (a new sender id): back in at once.
    await wren.session.leave();
    await r.settle();
    const wrenP = r.people[1];
    const back = await r.open(
      wrenP,
      { agreement: wrenP.agreement, chain: record.chain, secret: secretOf(record), wraps: record.wraps },
      r.net.connect(),
    );
    await r.settle();
    host.edit((d) => ({ ...d, title: "Still reachable" }));
    await r.settle();
    expect(title(back)).toBe("Still reachable");
    // Someone new still knocks and is let in.
    const k = await r.knock("otter");
    expect(host.session.knocks.has(k.p.identity.key)).toBe(true);
    expect(await host.session.admit(k.p.identity.key)).toBe(true);
    await r.settle();
    expect(k.outcome()).toBe("admitted");
    // The door's peers go: their places with them.
    shared.close();
    for (const t of many) t.close();
    await r.settle();
    expect(lobbyOf(host).load().guests).toBe(0);
  });

  it("a key-agreement key that can't be used isn't let in, and a later removal still moves the room on", async () => {
    const r = await knockRoom(77);
    const host = r.host.client!;
    const otter = await r.join("otter");
    const evil = await r.rogue();
    await evil.send({ t: "hello", x: "A".repeat(43), alias: "Zero" });
    expect(host.session.knocks.has(evil.id.key)).toBe(true);
    expect(await host.session.admit(evil.id.key)).toBe(false);
    expect(host.session.signed!.state().members.has(evil.id.key)).toBe(false);
    expect(await host.session.remove(otter.session.signed!.key)).toBe(true);
    await r.settle();
    expect(host.session.keys.epoch).toBe(1);
    expect(host.session.signed!.current!.epoch).toBe(1);
  });

  it("after a re-key, members' presence still updates (its ordering starts over), and the removed one's goes", async () => {
    const r = await knockRoom(78);
    const host = r.host.client!;
    const w = await r.join("w");
    const x = await r.join("x");
    for (let i = 0; i < 20; i++) w.session.setSelection([`n${i}`]);
    await r.settle();
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    await r.settle();
    w.session.setPresence({ alias: "Renamed" });
    await r.settle();
    const peers = host.session.peers();
    expect(peers.map((p) => p.alias)).toEqual(["Renamed"]);
  });
});

describe("Remove overlapping the host's other roster changes: one outcome everywhere, nothing lost", () => {
  /** A room with a co-host, a member and someone to remove; every live page's epoch and roles once it settles. */
  async function room(seed: number) {
    const r = await knockRoom(seed);
    const host = r.host.client!;
    const co = await r.join("co");
    const m = await r.join("m");
    const x = await r.join("x");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
        await r.settle();
      }
    };
    /** The pages expected to stay: each still in (not left, not removed), all in one epoch with the same roles. */
    const agreed = (pages: TestClient[]) => {
      for (const c of pages) {
        expect(c.session.status).not.toBe("left");
        expect(c.session.removed).toBe(false);
        expect(c.session.knocking).toBe(false);
      }
      const starts = new Set(pages.map((c) => c.session.signed!.current!.sig));
      expect(starts.size).toBe(1);
      const s = pages.map((c) => c.session.signed!.state());
      for (const each of s) {
        expect(each.host).toBe(s[0].host);
        expect(each.ask).toBe(s[0].ask);
        expect(each.viewOnly).toBe(s[0].viewOnly);
      }
      return { epoch: host.session.signed!.current!.epoch, state: s[0] };
    };
    return { r, host, co, m, x, settle, agreed };
  }

  it("Make host, then Remove: the handover holds, and the old host can no longer remove", async () => {
    const { host, co, m, x, settle, agreed } = await room(101);
    const handed = host.session.appendRoster("host", { who: co.session.signed!.key });
    const removed = host.session.remove(x.session.signed!.key);
    expect(await handed).toBe(true);
    expect(await removed).toBe(false);
    await settle();
    const { epoch, state } = agreed([host, co, m, x]);
    expect(epoch).toBe(0);
    expect(state.host).toBe(co.session.signed!.key);
    expect(state.members.has(x.session.signed!.key)).toBe(true);
  });

  it("Remove, then Make host: both hold, the handover in the next epoch", async () => {
    const { host, co, m, x, settle, agreed } = await room(102);
    const removed = host.session.remove(x.session.signed!.key);
    const handed = host.session.appendRoster("host", { who: co.session.signed!.key });
    expect(await removed).toBe(true);
    expect(await handed).toBe(true);
    await settle();
    expect(x.session.removed).toBe(true);
    const { epoch, state } = agreed([host, co, m]);
    expect(epoch).toBe(1);
    expect(state.host).toBe(co.session.signed!.key);
    expect(state.members.has(x.session.signed!.key)).toBe(false);
  });

  it("a policy change and Remove, either way round: both hold, and the next epoch keeps the policy", async () => {
    for (const [seed, first] of [
      [103, "policy"],
      [104, "remove"],
    ] as const) {
      const { host, co, m, x, settle, agreed } = await room(seed);
      const jobs =
        first === "policy"
          ? [
              host.session.appendRoster("policy", { viewOnly: true }),
              host.session.appendRoster("ask", { ask: false }),
              host.session.remove(x.session.signed!.key),
            ]
          : [
              host.session.remove(x.session.signed!.key),
              host.session.appendRoster("policy", { viewOnly: true }),
              host.session.appendRoster("ask", { ask: false }),
            ];
      expect(await Promise.all(jobs)).toEqual([true, true, true]);
      await settle();
      expect(x.session.removed).toBe(true);
      const { epoch, state } = agreed([host, co, m]);
      expect(epoch).toBe(1);
      expect(state.viewOnly).toBe(true);
      expect(state.ask).toBe(false);
    }
  });

  it("letting someone in and Remove, either way round (by hand, or on its own with Ask off): both hold", async () => {
    for (const [seed, how] of [
      [105, "admit first"],
      [106, "remove first"],
      [107, "ask off"],
    ] as const) {
      const { r, host, co, m, x, settle, agreed } = await room(seed);
      if (how === "ask off") expect(await host.session.appendRoster("ask", { ask: false })).toBe(true);
      const k = how === "ask off" ? undefined : await r.knock(`new${seed}`);
      const jobs =
        how === "admit first"
          ? [host.session.admit(k!.p.identity.key), host.session.remove(x.session.signed!.key)]
          : [host.session.remove(x.session.signed!.key), ...(k ? [host.session.admit(k.p.identity.key)] : [])];
      // With Ask off, someone knocks while the removal is under way: let in on their own.
      const late = how === "ask off" ? await r.knock(`new${seed}`) : undefined;
      expect(await Promise.all(jobs)).toEqual(jobs.map(() => true));
      await settle();
      const newcomer = (k ?? late)!;
      expect(newcomer.outcome()).toBe("admitted");
      expect(x.session.removed).toBe(true);
      const { epoch, state } = agreed([host, co, m, newcomer.client]);
      expect(epoch).toBe(1);
      expect(state.members.has(newcomer.p.identity.key)).toBe(true);
      expect(newcomer.client.session.signed!.current!.sig).toBe(host.session.signed!.current!.sig);
      host.edit((d) => ({ ...d, title: `After ${how}` }));
      await r.settle();
      expect(title(newcomer.client)).toBe(`After ${how}`);
    }
  }, 20_000);
});

describe("knock-to-join: chains, denials and leaving, message by message", () => {
  /** Lobby messages as the host's identity, from a transport of their own, one at a time, in order. */
  async function asHost(r: Awaited<ReturnType<typeof knockRoom>>) {
    const host = r.host.client!;
    const evil = await r.rogue(host.session.signed!.identity);
    return async (body: LobbyBody, to: TestClient) => {
      await evil.send(body, to.session.transport.self);
      await r.settle();
    };
  }

  it("retains a wrap delivered before its chain", async () => {
    const r = await knockRoom(111);
    const host = r.host.client!;
    const k = await r.knock("wren");
    // Let in by the host's roster, but nothing sent: the wrap and the chain come by hand, the wrap first.
    host.session.knocks.delete(k.p.identity.key);
    expect(await host.session.signed!.append("join", { who: k.p.identity.key, x: k.p.agreement.x })).toBeDefined();
    const current = host.session.signed!.current!;
    const wrap = await wrapFor(
      r.lobbyKeys.roomId,
      scopeOf(current),
      { identity: r.host.identity, agreement: r.host.agreement },
      { key: k.p.identity.key, x: k.p.agreement.x },
      r.secret,
    );
    const send = await asHost(r);
    await send({ t: "bundle", chain: { starts: [], logs: [] }, wraps: [wrap] }, k.client);
    expect(k.outcome()).toBeUndefined();
    await send({ t: "bundle", chain: chainOf(host), wraps: [] }, k.client);
    expect(k.outcome()).toBe("admitted");
    expect(k.client.session.signed!.current!.sig).toBe(current.sig);
  });

  it("buffers a denial until its named epoch arrives", async () => {
    const r = await knockRoom(112);
    const host = r.host.client!;
    const x = await r.join("x");
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    await r.settle();
    const k = await r.knock("wren");
    const send = await asHost(r);
    // The no first, naming epoch 1 (which this page doesn't have yet), then the chain: once, in that order.
    await send(
      { t: "deny", to: k.p.identity.key, chain: { starts: [], logs: [] }, tip: host.session.signed!.scope },
      k.client,
    );
    expect(k.outcome()).toBeUndefined();
    await send({ t: "bundle", chain: chainOf(host), wraps: [], more: true }, k.client);
    expect(k.outcome()).toBe("denied");
  });

  it("a no counts only from who hosts or co-hosts now: a removed co-host naming the epoch it led changes nothing", async () => {
    const r = await knockRoom(113);
    const host = r.host.client!;
    const co = await r.join("co");
    const y = await r.join("y");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const epoch0 = chainOf(co);
    expect(await host.session.remove(co.session.signed!.key)).toBe(true);
    await r.settle();
    expect(await host.session.remove(y.session.signed!.key)).toBe(true);
    await r.settle();
    const k = await r.knock("wren");
    // This page has the room's chain through epoch 2.
    await (
      await asHost(r)
    )({ t: "bundle", chain: chainOf(host), wraps: [], more: true }, k.client);
    expect(k.client.session.signed!.knock!.chain.deepest()!.epoch).toBe(2);
    const evil = await r.rogue(co.session.signed!.identity);
    // Naming epoch 0, where it co-hosted; with epoch 0's chain; with nothing: none of them counts.
    for (const deny of [
      { t: "deny" as const, to: k.p.identity.key, chain: { starts: [], logs: [] }, tip: scopeOf(r.start) },
      { t: "deny" as const, to: k.p.identity.key, chain: epoch0 },
      { t: "deny" as const, to: k.p.identity.key, chain: epoch0, tip: scopeOf(r.start) },
    ]) {
      await evil.send(deny, k.client.session.transport.self);
      await r.settle();
      expect(k.outcome()).toBeUndefined();
      expect(k.client.session.status).not.toBe("left");
    }
  });

  it("a no waiting for its epoch keeps nothing of its chain: each later bundle is taken once, the no's chain never again", async () => {
    const r = await knockRoom(114);
    const host = r.host.client!;
    await r.join("y");
    const k = await r.knock("wren");
    const chain = k.client.session.signed!.knock!.chain;
    const add = vi.spyOn(chain, "add");
    onTestFinished(() => add.mockRestore());
    const send = await asHost(r);
    await send(
      { t: "deny", to: k.p.identity.key, chain: chainOf(host), tip: `5:${bytesToBase64Url(seededBytes(1140)(64))}` },
      k.client,
    );
    for (let i = 0; i < 5; i++) await send({ t: "bundle", chain: { starts: [], logs: [] }, wraps: [] }, k.client);
    expect(add).toHaveBeenCalledTimes(6);
    expect(add.mock.calls.filter(([data]) => data.logs.length > 0)).toHaveLength(1);
    expect(k.outcome()).toBeUndefined();
  });

  it("a page catching up isn't ejected by part of a chain: removed in epoch 1, let back in by epoch 2, it follows to 2", async () => {
    const r = await knockRoom(115);
    const host = r.host.client!;
    const a = await r.join("a");
    const b = await r.join("b");
    const aKey = a.session.signed!.key;
    const record = a.session.memberRecord()!;
    await a.session.leave();
    expect(await host.session.remove(aKey)).toBe(true);
    await r.settle();
    // a comes back (another tab, the same person) and is let in again; then b is removed: a is in epoch 2.
    const aP = r.people[1];
    const again = await r.open(aP, { agreement: aP.agreement, chain: { starts: [], logs: [] } }, r.net.connect());
    await r.settle();
    expect(await host.session.admit(aKey)).toBe(true);
    await r.settle();
    expect(await host.session.remove(b.session.signed!.key)).toBe(true);
    await r.settle();
    const data = chainOf(host);
    expect(data.starts).toHaveLength(3);
    const current = host.session.signed!.current!;
    const secret2 = host.session.signed!.knock!.chain.secretOf(current)!;
    const wrap = await wrapFor(
      r.lobbyKeys.roomId,
      scopeOf(current),
      { identity: r.host.identity, agreement: r.host.agreement },
      { key: aKey, x: aP.agreement.x },
      secret2,
    );
    // The old tab reopens on its old record (epoch 0), reachable only by pieces sent by hand.
    const transport = r.net.connect();
    const send = await (async () => {
      const evil = await r.rogue(host.session.signed!.identity, transport);
      return evil;
    })();
    const old = await r.open(
      aP,
      { agreement: aP.agreement, chain: record.chain, secret: secretOf(record), wraps: record.wraps },
      r.net.connect(),
    );
    r.net.partition([[old.session.transport.self, transport.self], [host, again].map((c) => c.session.transport.self)]);
    await r.settle();
    const tip = scopeOf(current);
    // Epochs 0 and 1 (its removal in 1) first: nothing irreversible yet.
    await send.send(
      {
        t: "bundle",
        chain: { starts: data.starts.slice(0, 2), logs: data.logs.slice(0, 2) },
        wraps: [],
        more: true,
        tip,
      },
      old.session.transport.self,
    );
    await r.settle();
    expect(old.session.removed).toBe(false);
    expect(old.session.status).not.toBe("left");
    // Then epoch 2, with its wrap: it's there.
    await send.send(
      { t: "bundle", chain: { starts: data.starts.slice(2), logs: data.logs.slice(2) }, wraps: [wrap], tip },
      old.session.transport.self,
    );
    await r.settle();
    expect(old.session.removed).toBe(false);
    expect(old.session.signed!.current!.sig).toBe(current.sig);
  });

  it("retains the pending chain tip across stale bundles", async () => {
    const r = await knockRoom(118);
    const host = r.host.client!;
    const a = await r.join("a");
    const b = await r.join("b");
    const aKey = a.session.signed!.key;
    const record = a.session.memberRecord()!;
    await a.session.leave();
    expect(await host.session.remove(aKey)).toBe(true);
    await r.settle();
    // Readmitted only in epoch 2's chain: b removed (epoch 2), then a let in again there.
    expect(await host.session.remove(b.session.signed!.key)).toBe(true);
    await r.settle();
    const aP = r.people[1];
    const again = await r.open(aP, { agreement: aP.agreement, chain: { starts: [], logs: [] } }, r.net.connect());
    await r.settle();
    expect(await host.session.admit(aKey)).toBe(true);
    await r.settle();
    const data = chainOf(host);
    const current = host.session.signed!.current!;
    const wrap = await wrapFor(
      r.lobbyKeys.roomId,
      scopeOf(current),
      { identity: r.host.identity, agreement: r.host.agreement },
      { key: aKey, x: aP.agreement.x },
      host.session.signed!.knock!.chain.secretOf(current)!,
    );
    // The old tab on its epoch-0 record, reachable only by what's sent by hand: as the host, and as a stranger.
    const [hostT, strangerT] = [r.net.connect(), r.net.connect()];
    const asHost = await r.rogue(host.session.signed!.identity, hostT);
    const stranger = await r.rogue(undefined, strangerT);
    const old = await r.open(
      aP,
      { agreement: aP.agreement, chain: record.chain, secret: secretOf(record), wraps: record.wraps },
      r.net.connect(),
    );
    r.net.partition([
      [old.session.transport.self, hostT.self, strangerT.self],
      [host, again].map((c) => c.session.transport.self),
    ]);
    await r.settle();
    const to = old.session.transport.self;
    const tip = scopeOf(current);
    await asHost.send(
      {
        t: "bundle",
        chain: { starts: data.starts.slice(0, 2), logs: data.logs.slice(0, 2) },
        wraps: [],
        more: true,
        tip,
      },
      to,
    );
    // A stale bundle (epoch 0 only, its own tip), then an empty one from someone who isn't a member: neither clears
    // what the first piece promised.
    await asHost.send(
      {
        t: "bundle",
        chain: { starts: data.starts.slice(0, 1), logs: data.logs.slice(0, 1) },
        wraps: [],
        tip: scopeOf(r.start),
      },
      to,
    );
    await stranger.send({ t: "bundle", chain: { starts: [], logs: [] }, wraps: [] }, to);
    expect(old.session.removed).toBe(false);
    expect(old.session.status).not.toBe("left");
    await asHost.send(
      { t: "bundle", chain: { starts: data.starts.slice(2), logs: data.logs.slice(2) }, wraps: [wrap], tip },
      to,
    );
    expect(old.session.removed).toBe(false);
    expect(old.session.signed!.current!.sig).toBe(current.sig);
  });

  it("defers denial authority checks until the pending chain is complete", async () => {
    const r = await knockRoom(119);
    const host = r.host.client!;
    const co = await r.join("co");
    const y = await r.join("y");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    // y removed in epoch 1; the co-host in epoch 2.
    expect(await host.session.remove(y.session.signed!.key)).toBe(true);
    await r.settle();
    expect(await host.session.remove(co.session.signed!.key)).toBe(true);
    await r.settle();
    const data = chainOf(host);
    const k = await r.knock("wren");
    const asHost = await r.rogue(host.session.signed!.identity);
    const formerCo = await r.rogue(co.session.signed!.identity);
    const to = k.client.session.transport.self;
    const tip = host.session.signed!.scope;
    // Epochs 0 and 1 (where the co-host still co-hosts), promising epoch 2.
    await asHost.send(
      {
        t: "bundle",
        chain: { starts: data.starts.slice(0, 2), logs: data.logs.slice(0, 2) },
        wraps: [],
        more: true,
        tip,
      },
      to,
    );
    // The former co-host's no, naming epoch 0: not taken while epoch 2 is on its way.
    await formerCo.send(
      { t: "deny", to: k.p.identity.key, chain: { starts: [], logs: [] }, tip: scopeOf(r.start) },
      to,
    );
    expect(k.outcome()).toBeUndefined();
    // Epoch 2 arrives: the co-host was removed there; its no counts for nothing.
    await asHost.send(
      { t: "bundle", chain: { starts: data.starts.slice(2), logs: data.logs.slice(2) }, wraps: [], tip },
      to,
    );
    expect(k.client.session.signed!.knock!.chain.deepest()!.epoch).toBe(2);
    expect(k.outcome()).toBeUndefined();
    expect(k.client.session.status).not.toBe("left");
    // The host's no still counts.
    host.session.deny(k.p.identity.key);
    await r.settle();
    expect(k.outcome()).toBe("denied");
  });

  it("a peer lying about how far its chain goes stalls decisions only until the catch-up deadline", async () => {
    const r = await knockRoom(120);
    const host = r.host.client!;
    const k = await r.knock("wren");
    const liar = await r.rogue();
    // Promises epoch 20 (a start nobody will send).
    await liar.send(
      { t: "bundle", chain: { starts: [], logs: [] }, wraps: [], tip: `20:${bytesToBase64Url(seededBytes(1200)(64))}` },
      k.client.session.transport.self,
    );
    host.session.deny(k.p.identity.key);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
    r.clock.advance(CATCH_UP_MS - COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
    // Past the deadline: decided from what's validated, the host's no.
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs * 2);
    await r.settle();
    expect(k.outcome()).toBe("denied");
  });

  it("Remove then Leave at once: the removal re-keys, the handover lands in the new epoch, and the new host can remove", async () => {
    const r = await knockRoom(116);
    const host = r.host.client!;
    const co = await r.join("co");
    const m = await r.join("m");
    const x = await r.join("x");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const removed = host.session.remove(x.session.signed!.key);
    // Leaving as the host leaves: the handover asked for, then the goodbye.
    const handed = host.session.appendRoster("host", { who: co.session.signed!.key });
    const left = host.session.leave();
    expect(await removed).toBe(true);
    expect(await handed).toBe(true);
    await left;
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(x.session.removed).toBe(true);
    for (const c of [co, m]) {
      expect(c.session.keys.epoch).toBe(1);
      expect(c.session.signed!.state().host).toBe(co.session.signed!.key);
    }
    expect(await co.session.remove(m.session.signed!.key)).toBe(true);
    await r.settle();
    expect(m.session.removed).toBe(true);
    expect(co.session.keys.epoch).toBe(2);
  });

  it("catch-up decisions wait for the chain being validated: a timer mid-validation ejects nobody", async () => {
    const r = await knockRoom(122);
    const host = r.host.client!;
    const a = await r.join("a");
    const b = await r.join("b");
    const aKey = a.session.signed!.key;
    const record = a.session.memberRecord()!;
    await a.session.leave();
    expect(await host.session.remove(aKey)).toBe(true);
    await r.settle();
    expect(await host.session.remove(b.session.signed!.key)).toBe(true);
    await r.settle();
    // Let back in only in epoch 2.
    const aP = r.people[1];
    await r.open(aP, { agreement: aP.agreement, chain: { starts: [], logs: [] } }, r.net.connect());
    await r.settle();
    expect(await host.session.admit(aKey)).toBe(true);
    await r.settle();
    const data = chainOf(host);
    const current = host.session.signed!.current!;
    const wrap = await wrapFor(
      r.lobbyKeys.roomId,
      scopeOf(current),
      { identity: r.host.identity, agreement: r.host.agreement },
      { key: aKey, x: aP.agreement.x },
      host.session.signed!.knock!.chain.secretOf(current)!,
    );
    const hostT = r.net.connect();
    const asHost = await r.rogue(host.session.signed!.identity, hostT);
    const old = await r.open(
      aP,
      { agreement: aP.agreement, chain: record.chain, secret: secretOf(record), wraps: record.wraps },
      r.net.connect(),
    );
    r.net.partition([[old.session.transport.self, hostT.self], [host.session.transport.self]]);
    await r.settle();
    // Epoch 2's roster (the join that lets a back in) is held mid-validation.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => (entered = resolve));
    const add = SignedRoster.prototype.add;
    const spy = vi.spyOn(SignedRoster.prototype, "add").mockImplementation(async function (
      this: SignedRoster,
      ...args: Parameters<SignedRoster["add"]>
    ) {
      if (this.epoch === scopeOf(current) && args[0].length) {
        entered();
        await gate;
      }
      return add.apply(this, args);
    });
    onTestFinished(() => spy.mockRestore());
    const tip = scopeOf(current);
    // Epochs 0 and 1 first (its removal in 1), promising epoch 2: taken in full.
    await asHost.send(
      {
        t: "bundle",
        chain: { starts: data.starts.slice(0, 2), logs: data.logs.slice(0, 2) },
        wraps: [],
        more: true,
        tip,
      },
      old.session.transport.self,
    );
    expect(old.session.removed).toBe(false);
    // Then epoch 2: its start placed, its roster held.
    for (const f of await asHost.lobby.seal({
      t: "bundle",
      chain: { starts: data.starts.slice(2), logs: data.logs.slice(2) },
      wraps: [wrap],
      tip,
    }))
      hostT.send(f, old.session.transport.self);
    // Delivered (not waited for: its validation is held), up to epoch 2's roster.
    const delivering = r.net.settle();
    try {
      await blocked;
      expect(old.session.status).not.toBe("left");
      // Past every deadline, timers firing, while it's still validating: nothing is decided on half a chain.
      for (let i = 0; i < 6; i++) {
        r.clock.advance(CATCH_UP_MS);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      }
      expect(old.session.removed).toBe(false);
      expect(old.session.status).not.toBe("left");
    } finally {
      release();
    }
    await delivering;
    await r.settle();
    expect(old.session.removed).toBe(false);
    expect(old.session.signed!.current!.sig).toBe(current.sig);
  });

  it("a removal's new keys are in place before the next frame: an old-epoch update right behind its bundle is refused", async () => {
    const r = await knockRoom(127);
    const host = r.host.client!;
    const x = await r.join("x");
    // m's transport hands frames on without waiting for each (as a real network can): and x's next update is held
    // back until the host's removal bundle reaches m, then handed on right behind it.
    const xSelf = x.session.transport.self;
    const hostSelf = host.session.transport.self;
    const held: Uint8Array[] = [];
    let arm = false;
    const mT = r.net.connect();
    const subscribe = mT.subscribe.bind(mT);
    mT.subscribe = (handlers) =>
      subscribe({
        ...handlers,
        frame: (from, bytes) => {
          if (arm && from === xSelf && bytes[3] === 1) {
            held.push(bytes);
            return;
          }
          void handlers.frame(from, bytes);
          if (arm && from === hostSelf && bytes[3] === 4 && bytes.length > 2_000 && held.length) {
            arm = false;
            for (const b of held.splice(0)) void handlers.frame(xSelf, b);
          }
        },
      });
    const mP: Person = { name: "m", identity: await newIdentity(), agreement: await newAgreement() };
    r.people.push(mP);
    const m = await r.open(mP, { agreement: mP.agreement, chain: { starts: [], logs: [] } }, mT);
    await r.settle();
    expect(await host.session.admit(mP.identity.key)).toBe(true);
    await r.settle();
    expect(m.session.knocking).toBe(false);
    // x's update reaches nobody else (the host doesn't take it in the old epoch either).
    const send = x.session.transport.send.bind(x.session.transport);
    x.session.transport.send = (bytes, to) => {
      if (to !== hostSelf && (to !== undefined || bytes[3] !== 1)) send(bytes, to);
      else if (to === undefined) send(bytes, m.session.transport.self);
    };
    arm = true;
    x.edit((d) => ({ ...d, title: "From the old key" }));
    await r.settle();
    expect(held.length).toBeGreaterThan(0);
    const before = rejected(m, "old-epoch");
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    await r.settle();
    expect(m.session.keys.epoch).toBe(1);
    expect(rejected(m, "old-epoch")).toBeGreaterThan(before);
    expect(title(m)).not.toBe("From the old key");
  });

  it("an awaited Remove, then at once a handover and Leave: the co-host becomes host, and can remove", async () => {
    const r = await knockRoom(123);
    const host = r.host.client!;
    const co = await r.join("co");
    const m = await r.join("m");
    const x = await r.join("x");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    // No settling: nobody has proved themselves in the new epoch to the host when it hands over and goes.
    expect(await host.session.remove(x.session.signed!.key)).toBe(true);
    const handed = host.session.appendRoster("host", { who: co.session.signed!.key });
    await host.session.leave();
    expect(await handed).toBe(true);
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    for (const c of [co, m]) {
      expect(c.session.keys.epoch).toBe(1);
      expect(c.session.signed!.state().host).toBe(co.session.signed!.key);
    }
    expect(await co.session.remove(m.session.signed!.key)).toBe(true);
    await r.settle();
    expect(m.session.removed).toBe(true);
  });

  it("peers taking turns lying about their chain can't stall a no past one catch-up deadline", async () => {
    const r = await knockRoom(124);
    const host = r.host.client!;
    const k = await r.knock("wren");
    const liars = [await r.rogue(), await r.rogue()];
    const lie = (i: number) =>
      liars[i % 2].send(
        {
          t: "bundle",
          chain: { starts: [], logs: [] },
          wraps: [],
          tip: `${20 + (i % 5)}:${bytesToBase64Url(seededBytes(1240 + i)(64))}`,
        },
        k.client.session.transport.self,
      );
    await lie(0);
    host.session.deny(k.p.identity.key);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
    // A fresh promise every 10 s, from one liar then the other.
    for (let i = 1; k.outcome() !== "denied" && i < 12; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await lie(i);
      if (i * 10_000 < CATCH_UP_MS) expect(k.outcome()).toBeUndefined();
    }
    expect(k.outcome()).toBe("denied");
  });

  it("alternating promises expire on the first anti-entropy tick at the catch-up deadline", async () => {
    const r = await knockRoom(128);
    const host = r.host.client!;
    const k = await r.knock("wren");
    const liars = [await r.rogue(), await r.rogue()];
    const lie = (i: number) =>
      liars[i % 2].send(
        {
          t: "bundle",
          chain: { starts: [], logs: [] },
          wraps: [],
          tip: `${20 + (i % 5)}:${bytesToBase64Url(seededBytes(1280 + i)(64))}`,
        },
        k.client.session.transport.self,
      );
    await lie(0);
    host.session.deny(k.p.identity.key);
    await r.settle();
    // Every tick up to the deadline (a promise from one liar, then the other, each time): still waiting.
    const tick = COLLAB_LIMITS.antiEntropyMs;
    let t = 0;
    for (let i = 1; t + tick < CATCH_UP_MS; i++) {
      await lie(i);
      r.clock.advance(tick);
      t += tick;
      await r.settle();
      expect(k.outcome()).toBeUndefined();
    }
    // The first tick at or past it: decided.
    await lie(99);
    r.clock.advance(tick);
    await r.settle();
    expect(k.outcome()).toBe("denied");
  });

  it("expired catch-up resumes removal without another bundle", async () => {
    const r = await knockRoom(125);
    const host = r.host.client!;
    const a = await r.join("a");
    const liar = await r.rogue();
    await liar.send(
      { t: "bundle", chain: { starts: [], logs: [] }, wraps: [], tip: `20:${bytesToBase64Url(seededBytes(1250)(64))}` },
      a.session.transport.self,
    );
    expect(await host.session.remove(a.session.signed!.key)).toBe(true);
    await r.settle();
    expect(a.session.removed).toBe(false);
    r.clock.advance(CATCH_UP_MS - COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(a.session.removed).toBe(false);
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs * 2);
    await r.settle();
    expect(a.session.removed).toBe(true);
    expect(a.session.status).toBe("left");
  });

  it("expired catch-up resumes re-knocking", async () => {
    const r = await knockRoom(126);
    const host = r.host.client!;
    const co = await r.join("co");
    const otter = await r.join("otter");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const k = await r.knock("wren");
    const liar = await r.rogue();
    await liar.send(
      { t: "bundle", chain: { starts: [], logs: [] }, wraps: [], tip: `20:${bytesToBase64Url(seededBytes(1260)(64))}` },
      k.client.session.transport.self,
    );
    const knocked: boolean[] = [];
    onTestFinished(k.client.session.onChange(() => knocked.push(k.client.session.knocking)));
    // Let in by the co-host just as the host removes someone: wren isn't in the next epoch.
    const admitted = co.session.admit(k.p.identity.key);
    const removed = host.session.remove(otter.session.signed!.key);
    expect(await admitted).toBe(true);
    expect(await removed).toBe(true);
    await r.settle();
    knocked.length = 0;
    r.clock.advance(CATCH_UP_MS - COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(knocked).not.toContain(true);
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs * 2);
    await r.settle();
    expect(knocked).toContain(true);
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(k.outcome()).toBe("admitted");
    expect(k.client.session.keys.epoch).toBe(1);
  });

  it("Leave in an unchanged epoch hands over with the roster entry alone: no chain sent to the lobby", async () => {
    const r = await knockRoom(121);
    const host = r.host.client!;
    const co = await r.join("co");
    const m = await r.join("m");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    let lobbyFrames = 0;
    const stop = r.net.tap((rec) => {
      if (rec.from === host.session.transport.self && rec.bytes[3] === 4) lobbyFrames++;
    });
    onTestFinished(stop);
    const handed = host.session.appendRoster("host", { who: co.session.signed!.key });
    await host.session.leave();
    expect(await handed).toBe(true);
    await r.settle();
    expect(lobbyFrames).toBe(0);
    for (const c of [co, m]) expect(c.session.signed!.state().host).toBe(co.session.signed!.key);
  });

  it("Admit waiting its turn takes the card at once: a Deny after it changes nothing, and they're let in", async () => {
    const r = await knockRoom(117);
    const host = r.host.client!;
    const x = await r.join("x");
    const k = await r.knock("wren");
    // A removal under way: the Admit waits its turn.
    const removed = host.session.remove(x.session.signed!.key);
    const admitted = host.session.admit(k.p.identity.key);
    expect(host.session.knocks.has(k.p.identity.key)).toBe(false);
    host.session.deny(k.p.identity.key);
    expect(await removed).toBe(true);
    expect(await admitted).toBe(true);
    for (let i = 0; i < 2; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(k.outcome()).toBe("admitted");
    expect(k.client.session.denied).toBe(false);
    expect(host.session.knocks.size).toBe(0);
  });
});

describe("knock-to-join: the review's smaller cases", () => {
  it("an admitted newcomer refuses a wrapped secret that isn't the epoch's, then takes the real one", async () => {
    const r = await knockRoom(81);
    const host = r.host.client!;
    const otter = await r.join("otter");
    const k = await r.knock("wren");
    // The host lets wren in (a join entry), but its bundle hasn't come; otter (a member) hands wren a wrong secret.
    expect(await host.session.appendRoster("join", { who: k.p.identity.key, x: k.p.agreement.x })).toBe(true);
    await r.settle();
    const lobby = new Lobby(r.lobbyKeys, r.people[1].identity, seededBytes(8101)(16), r.clock);
    const wrong = await wrapFor(
      r.lobbyKeys.roomId,
      scopeOf(r.start),
      { identity: r.people[1].identity, agreement: r.people[1].agreement },
      { key: k.p.identity.key, x: k.p.agreement.x },
      newEpochSecret(seededBytes(8102)),
    );
    for (const f of await lobby.seal({ t: "bundle", chain: chainOf(host), wraps: [wrong] }))
      otter.session.transport.send(f, k.transport.self);
    await r.settle();
    expect(k.outcome()).toBeUndefined();
    expect(k.client.session.hasDocument).toBe(false);
    expect(
      await host.session.admit(k.p.identity.key, {
        key: k.p.identity.key,
        x: k.p.agreement.x,
        alias: "wren",
        peer: k.transport.self,
        sender: "",
        at: 0,
      }),
    ).toBe(true);
    await r.settle();
    expect(k.outcome()).toBe("admitted");
  });

  it("someone removed and let back in isn't removed again by a later, unrelated removal", async () => {
    const r = await knockRoom(82);
    const host = r.host.client!;
    const a = await r.join("a");
    const b = await r.join("b");
    const aKey = a.session.signed!.key;
    expect(await host.session.remove(aKey)).toBe(true);
    await r.settle();
    // a comes back (a new session, the same person) and is let in again.
    const aP = r.people[1];
    const transport = r.net.connect();
    const again = await r.open(aP, { agreement: aP.agreement, chain: { starts: [], logs: [] } }, transport);
    await r.settle();
    expect(await host.session.admit(aKey)).toBe(true);
    await r.settle();
    expect(again.session.knocking).toBe(false);
    expect(await host.session.remove(b.session.signed!.key)).toBe(true);
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(host.session.keys.epoch).toBe(2);
    expect(again.session.removed).toBe(false);
    expect(host.session.signed!.state().members.has(aKey)).toBe(true);
  });

  it("a co-host made a member again has no knocks to answer: they go with the role", async () => {
    const r = await knockRoom(92);
    const host = r.host.client!;
    const co = await r.join("co");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    const k = await r.knock("wren");
    expect(co.session.knocks.has(k.p.identity.key)).toBe(true);
    expect(await host.session.appendRoster("uncohost", { who: co.session.signed!.key })).toBe(true);
    await r.settle();
    expect(co.session.knocks.size).toBe(0);
    expect(host.session.knocks.has(k.p.identity.key)).toBe(true);
  });

  it("waiting to be let in ends when everyone who answered has gone: the no-answer wait runs again", async () => {
    const r = await knockRoom(95);
    const host = r.host.client!;
    const k = await r.knock("wren");
    expect(k.client.session.lobbyAnswered).toBe(true);
    expect(k.client.session.waiting).toBe("admission");
    await host.session.leave();
    await r.settle();
    expect(k.client.session.lobbyAnswered).toBe(false);
    expect(k.client.session.waiting).toBe("peers");
    r.clock.advance(COLLAB_LIMITS.noAnswerMs + 1_000);
    await r.settle();
    expect(k.client.session.noAnswer).toBe(true);
  });

  it("knock cards keep their order as their knocks are said again", async () => {
    const r = await knockRoom(96);
    const host = r.host.client!;
    const knocks = [];
    for (const name of ["a", "b", "c"]) knocks.push(await r.knock(name));
    const order = () => [...host.session.knocks.values()].map((k) => k.alias);
    expect(order()).toEqual(["a", "b", "c"]);
    // The first two say it again, in turn, then everyone.
    for (const k of [knocks[1], knocks[0]]) {
      (k.client.session as unknown as { sayHello(): void }).sayHello();
      await r.settle();
      expect(order()).toEqual(["a", "b", "c"]);
    }
    r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    await r.settle();
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("a lobby message left half-delivered goes on the room clock, and with the session", async () => {
    const r = await knockRoom(97);
    const host = r.host.client!;
    const evil = await r.rogue();
    const size = COLLAB_LIMITS.maxFragmentBytes;
    const body = new Uint8Array(1 + 12 + size);
    const view = new DataView(body.buffer);
    body[0] = 5;
    view.setUint32(1, 1);
    view.setUint16(5, 0);
    view.setUint16(7, 3);
    view.setUint32(9, size * 2 + 10);
    const plain = new Uint8Array(body.length + 32);
    plain.set(body);
    plain.set(base64UrlToBytes(evil.id.key), body.length);
    const sealer = (evil.lobby as unknown as { sealer: { seal(c: "lobby", p: Uint8Array): Promise<Uint8Array> } })
      .sealer;
    evil.transport.send(await sealer.seal("lobby", plain), host.session.transport.self);
    await r.settle();
    const held = () => (host.session as unknown as { lobby: { reassembler: { held: number } } }).lobby.reassembler.held;
    expect(held()).toBe(size * 2 + 10);
    // Nothing more arrives from anyone: it goes on its own.
    r.clock.advance(COLLAB_LIMITS.partialTtlMs * 2 + 1);
    await r.settle();
    expect(held()).toBe(0);
  });

  it("with Ask before people join off, newcomers are let in on their own: by the host, else a co-host, never by others", async () => {
    const r = await knockRoom(98);
    const host = r.host.client!;
    const co = await r.join("co");
    const plain = await r.join("plain");
    expect(await host.session.appendRoster("cohost", { who: co.session.signed!.key })).toBe(true);
    expect(await host.session.appendRoster("ask", { ask: false })).toBe(true);
    await r.settle();
    host.edit((d) => ({ ...d, title: "Open door" }));
    await r.settle();
    // The host here: let in without anyone answering.
    const a = await r.knock("a");
    await r.settle();
    expect(a.outcome()).toBe("admitted");
    expect(title(a.client)).toBe("Open door");
    // The host away: the co-host lets them in.
    await host.session.leave();
    await r.settle();
    const b = await r.knock("b");
    for (let i = 0; i < 3 && b.outcome() !== "admitted"; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(b.outcome()).toBe("admitted");
    expect(title(b.client)).toBe("Open door");
    // Neither here: nobody else lets anyone in, and nothing of the room reaches them.
    await co.session.leave();
    await r.settle();
    const c = await r.knock("c");
    const seen = contentFramesTo(r.net, c.client.session.transport.self);
    for (let i = 0; i < 3; i++) {
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
      await r.settle();
    }
    expect(c.outcome()).toBeUndefined();
    expect(c.client.session.hasDocument).toBe(false);
    expect(seen()).toEqual([]);
    expect(plain.session.signed!.state().members.has(c.p.identity.key)).toBe(false);
  });

  it("waiting to be let in isn't 'nobody answered': with someone here, the no-answer wait doesn't run out", async () => {
    const r = await knockRoom(83);
    const k = await r.knock("wren");
    r.clock.advance(COLLAB_LIMITS.noAnswerMs + 1_000);
    await r.settle();
    expect(k.client.session.lobbyAnswered).toBe(true);
    expect(k.client.session.noAnswer).toBe(false);
  });
});

function chainOf(c: TestClient): ChainData {
  return c.session.signed!.knock!.chain.data(c.session.signed!.current);
}
