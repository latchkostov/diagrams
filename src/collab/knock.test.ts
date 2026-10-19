import { describe, expect, it, onTestFinished } from "vitest";
import { base64UrlToBytes } from "../interop/codec";
import { FakeClock } from "./clock";
import { Sealer } from "./envelope";
import { commitEpoch, MAX_EPOCHS, scopeOf, signStart, type ChainData } from "./epochs";
import { Opener } from "./envelope";
import { signEntry } from "./roster";
import { deriveEpochKeys, deriveRoomKeys, newEpochSecret } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import type { RoomLink } from "./link";
import { Lobby, wrapFor, type LobbyBody } from "./lobby";
import { DOC, frame } from "./protocol";
import { textToBytes } from "../interop/codec";
import { seededBytes } from "./random";
import type { KnockMember } from "./session";
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
  return { net, clock, link, lobbyKeys, host, people, settle, knock, join, open, rogue, start };
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

  it("a co-host removes someone; the host removes a co-host (whose roles go with them)", async () => {
    const r = await knockRoom(63);
    const host = r.host.client!;
    const wren = await r.join("wren");
    const otter = await r.join("otter");
    const newt = await r.join("newt");
    expect(await host.session.appendRoster("cohost", { who: wren.session.signed!.key })).toBe(true);
    await r.settle();
    expect(await wren.session.remove(otter.session.signed!.key)).toBe(true);
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

  it("a removal during a partition: each side's removal resolves to one epoch; the other is made again", async () => {
    const r = await knockRoom(64);
    const host = r.host.client!;
    const cohost = await r.join("cohost");
    const p = await r.join("p");
    const q = await r.join("q");
    expect(await host.session.appendRoster("cohost", { who: cohost.session.signed!.key })).toBe(true);
    await r.settle();
    r.net.partition([
      [host.session.transport.self, p.session.transport.self],
      [cohost.session.transport.self, q.session.transport.self],
    ]);
    await r.settle();
    expect(await host.session.remove(q.session.signed!.key)).toBe(true);
    expect(await cohost.session.remove(p.session.signed!.key)).toBe(true);
    await r.settle();
    expect(host.session.keys.epoch).toBe(1);
    expect(cohost.session.keys.epoch).toBe(1);
    r.net.heal();
    for (let i = 0; i < 4; i++) {
      await r.settle();
      r.clock.advance(COLLAB_LIMITS.antiEntropyMs);
    }
    await r.settle();
    // Both removals hold, and the two left are in one epoch.
    expect(p.session.removed).toBe(true);
    expect(q.session.removed).toBe(true);
    expect(host.session.keys.epoch).toBe(2);
    expect(cohost.session.keys.epoch).toBe(2);
    expect(host.session.memberRecord()!.chain.starts.at(-1)).toEqual(
      cohost.session.memberRecord()!.chain.starts.at(-1),
    );
    host.edit((d) => ({ ...d, title: "Healed" }));
    await r.settle();
    expect(title(cohost)).toBe("Healed");
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
    await evil.send({ t: "bundle", chain: { starts: junk, logs: [] }, wraps: [] });
    expect(host.session.signed!.knock!.chain.validated()).toHaveLength(1);
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
    const sig = () =>
      Array.from(
        seededBytes(Math.floor(Math.random() * 1e9))(64),
        (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b & 63],
      )
        .join("")
        .slice(0, 85) + "A";
    const starts = [];
    for (let epoch = 1; epoch < 32; epoch++)
      for (let i = 0; i < 2; i++)
        starts.push(await signStart(evil.id, roomId, { epoch, kc: "A".repeat(43), prev: sig() }));
    await evil.send({ t: "bundle", chain: { starts: starts.slice(0, 62), logs: [] }, wraps: [] });
    expect(host.session.signed!.knock!.chain.validated()).toHaveLength(1);
  }, 20_000);

  it("unplaceable starts require bounded resolution work: counted, within what the pool and the chain allow, however many epochs they claim", async () => {
    const r = await knockRoom(86);
    const host = r.host.client!;
    await r.join("wren");
    const chain = host.session.signed!.knock!.chain;
    const roomId = r.lobbyKeys.roomId;
    const sig = (n: number) =>
      Array.from(
        seededBytes(8600 + n)(64),
        (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b & 63],
      )
        .join("")
        .slice(0, 85) + "A";
    // Each sender a bundle of unplaceable starts (a parent's removal that's nowhere), claiming `epochs` epochs.
    const flood = async (epochs: number) => {
      const evil = await r.rogue();
      const starts = [];
      for (let epoch = 1; epoch <= epochs; epoch++)
        for (let i = 0; i < 2; i++)
          starts.push(await signStart(evil.id, roomId, { epoch, kc: "A".repeat(43), prev: sig(epoch * 2 + i) }));
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
    // The same message (its signature with it) under a far higher counter.
    const replayer = new Sealer(r.lobbyKeys, sender);
    (replayer as unknown as { counters: { lobby: number } }).counters.lobby = 1_000_000;
    attacker.send(await replayer.seal("lobby", plain.plaintext));
    // Its message changed by a byte (re-sealed properly, so it reaches the signature check).
    const tampered = plain.plaintext.slice();
    tampered[5] ^= 1;
    (replayer as unknown as { counters: { lobby: number } }).counters.lobby = 2_000_000;
    attacker.send(await replayer.seal("lobby", tampered));
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
