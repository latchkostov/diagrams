import { describe, expect, it } from "vitest";
import { commitEpoch, EpochChain, MAX_EPOCHS, parseStart, scopeOf, signStart, type EpochStart } from "./epochs";
import { newEpochSecret } from "./keys";
import { seededBytes } from "./random";
import { afterRemoval, MAX_LOG_ENTRIES, rootState, signEntry, SignedRoster } from "./roster";
import { newAgreement, newIdentity, type Identity } from "./signing";
import { LOBBY, Lobby, MAX_LOBBY_MESSAGE_BYTES, parseBody, unwrap, wrapFor } from "./lobby";
import { COLLAB_LIMITS } from "./limits";
import { base64UrlToBytes, bytesToBase64Url } from "../interop/codec";
import { deriveRoomKeys } from "./keys";
import { FakeClock } from "./clock";

const ROOM = "room-id-for-tests";

async function startOf(host: Identity, secret: Uint8Array): Promise<EpochStart> {
  const x = (await newAgreement()).x;
  return signStart(host, ROOM, { epoch: 0, kc: await commitEpoch(secret, ROOM, 0), x });
}

describe("epochs", () => {
  it("a single reverse delivery retains each roster until its parent starts resolve", async () => {
    const host = await newIdentity();
    const chain = new EpochChain(host.key, ROOM);
    let start = await startOf(host, newEpochSecret(seededBytes(600)));
    await chain.addStarts([start]);
    for (let epoch = 1; epoch < 4; epoch++) {
      const roster = chain.rosterOf(start)!;
      const away = await newIdentity();
      await roster.append(host, "join", { who: away.key, x: (await newAgreement()).x });
      const removal = (await roster.append(host, "remove", { who: away.key }))!;
      start = await signStart(host, ROOM, {
        epoch,
        kc: await commitEpoch(newEpochSecret(seededBytes(600 + epoch)), ROOM, epoch),
        prev: removal.sig,
      });
      await chain.addStarts([start]);
    }
    await chain.rosterOf(start)!.append(host, "ask", { ask: false });
    const data = chain.data(start);
    const received = new EpochChain(host.key, ROOM);
    for (let i = data.starts.length - 1; i >= 0; i--) {
      await received.add({ starts: [data.starts[i]], logs: [data.logs[i]] });
    }
    expect(received.data(received.deepest())).toEqual(data);
    expect(received.rosterOf(start)!.state().ask).toBe(false);
  });

  it("pending logs are limited to verified waiting starts and bounded entry counts", async () => {
    const host = await newIdentity();
    const chain = new EpochChain(host.key, ROOM);
    const entry = await signEntry(host, ROOM, "missing", { n: 1, op: "ask", ask: true, deps: [] });
    const pending = (chain as unknown as { waitingEntries: Map<string, Map<string, unknown>> }).waitingEntries;
    await chain.addEntries("missing", [entry]);
    expect(pending.size).toBe(0);
    for (let epoch = 1; epoch <= 20; epoch++) {
      const start = await signStart(host, ROOM, {
        epoch: 1,
        kc: await commitEpoch(newEpochSecret(seededBytes(800 + epoch)), ROOM, 1),
        prev: entry.sig,
      });
      await chain.addStarts([start]);
      const entries = Array.from({ length: MAX_LOG_ENTRIES + 1 }, (_, i) => ({
        ...entry,
        sig: bytesToBase64Url(seededBytes(epoch * 10_000 + i)(64)),
      }));
      await chain.addEntries(scopeOf(start), entries);
    }
    expect(pending.size).toBe(16);
    expect([...pending.values()].every((entries) => entries.size <= MAX_LOG_ENTRIES)).toBe(true);
    expect([...pending.values()].at(-1)!.size).toBe(MAX_LOG_ENTRIES);
  });

  it("epoch 0 starts with the link's host; a start by anyone else, or a forged one, isn't the room's", async () => {
    const [host, mallory] = [await newIdentity(), await newIdentity()];
    const secret = newEpochSecret(seededBytes(1));
    const real = await startOf(host, secret);
    const chain = new EpochChain(host.key, ROOM);
    const fake = await startOf(mallory, secret);
    const forged = { ...(await startOf(mallory, secret)), by: host.key };
    await chain.addStarts([fake, forged]);
    expect(chain.deepest()).toBeUndefined();
    await chain.addStarts([real]);
    expect(chain.deepest()?.sig).toBe(real.sig);
  });

  it("an epoch's secret is checked against its start's commitment: a made-up one isn't learned", async () => {
    const host = await newIdentity();
    const secret = newEpochSecret(seededBytes(2));
    const start = await startOf(host, secret);
    const chain = new EpochChain(host.key, ROOM);
    await chain.addStarts([start]);
    expect(await chain.learn(start, newEpochSecret(seededBytes(3)))).toBe(false);
    expect(chain.secretOf(start)).toBeUndefined();
    expect(await chain.learn(start, secret)).toBe(true);
  });

  it("a later epoch's start counts only signed by the host who closed its parent with a removal; the line never forks", async () => {
    const [host, cohost, wren] = [await newIdentity(), await newIdentity(), await newIdentity()];
    const chain = new EpochChain(host.key, ROOM);
    const start = await startOf(host, newEpochSecret(seededBytes(4)));
    await chain.addStarts([start]);
    const r0 = chain.rosterOf(start)!;
    const [cx, wx] = [(await newAgreement()).x, (await newAgreement()).x];
    await r0.append(host, "join", { who: cohost.key, x: cx });
    await r0.append(host, "join", { who: wren.key, x: wx });
    await r0.append(host, "cohost", { who: cohost.key });
    // A co-host can't remove: its entry isn't made, and one it signs anyway doesn't count.
    expect(await r0.append(cohost, "remove", { who: wren.key })).toBeUndefined();
    const heads = r0.heads();
    const forged = await signEntry(cohost, ROOM, scopeOf(start), {
      n: Math.max(...heads.map((h) => r0.entry(h)!.n)) + 1,
      op: "remove",
      who: wren.key,
      deps: heads,
    });
    expect(await r0.add([forged])).toMatchObject({ added: 0, refused: 1 });
    const removal = (await r0.append(host, "remove", { who: wren.key }))!;
    expect(r0.state().removal?.sig).toBe(removal.sig);
    const next = newEpochSecret(seededBytes(5));
    const kc = await commitEpoch(next, ROOM, 1);
    // The co-host signs a start for the host's removal, or for its own: neither is the next epoch. Nor one naming no
    // removal of this one.
    const byCohost = await signStart(cohost, ROOM, { epoch: 1, kc, prev: removal.sig });
    const ownRemoval = await signStart(cohost, ROOM, { epoch: 1, kc, prev: forged.sig });
    const elsewhere = await signStart(host, ROOM, { epoch: 1, kc, prev: start.sig });
    await chain.addStarts([byCohost, ownRemoval, elsewhere]);
    expect(chain.deepest()?.sig).toBe(start.sig);
    const real = await signStart(host, ROOM, { epoch: 1, kc, prev: removal.sig });
    await chain.addStarts([real]);
    expect(chain.deepest()?.sig).toBe(real.sig);
    expect(chain.parentOf(real)?.sig).toBe(start.sig);
    // A second start for the same epoch (even the host's own) has no place: the line doesn't fork.
    const again = await signStart(host, ROOM, {
      epoch: 1,
      kc: await commitEpoch(newEpochSecret(seededBytes(6)), ROOM, 1),
      prev: removal.sig,
    });
    await chain.addStarts([again]);
    expect(chain.validated().map((st) => st.sig)).toEqual([start.sig, real.sig]);
    // The next epoch starts from this one's state without whom it removed.
    const s = chain.rosterOf(real)!.state();
    expect(s.members.has(wren.key)).toBe(false);
    expect([...s.members].sort()).toEqual([host.key, cohost.key].sort());
    expect(s.cohosts).toEqual([cohost.key]);
    // A chain from a record or a bundle gives the same, whatever else it carries.
    const data = chain.data(real);
    data.starts.push(byCohost, ownRemoval);
    data.logs[0].entries.push(forged);
    const restored = new EpochChain(host.key, ROOM);
    await restored.add(data);
    expect(restored.validated().map((st) => st.sig)).toEqual([start.sig, real.sig]);
    expect(scopeOf(restored.deepest()!)).toBe(scopeOf(real));
  });

  it("a start stays named whatever forks arrive: before it, after it, or in a reload, the line is the same", async () => {
    const host = await newIdentity();
    const others = [await newIdentity(), await newIdentity(), await newIdentity()];
    const chain = new EpochChain(host.key, ROOM);
    const start = await startOf(host, newEpochSecret(seededBytes(50)));
    await chain.addStarts([start]);
    const r0 = chain.rosterOf(start)!;
    for (const o of others) await r0.append(host, "join", { who: o.key, x: (await newAgreement()).x });
    // Two removals in one slot, signed once (a misbehaving host's, or a former host's later on): the one that sorts
    // later is the removal the start names, kept first; the other, sorting first, is the fork that takes the slot.
    const deps = r0.heads();
    const n = Math.max(...deps.map((d) => r0.entry(d)!.n)) + 1;
    const [fork, removal] = (
      await Promise.all(
        [others[0], others[1]].map((o) => signEntry(host, ROOM, scopeOf(start), { n, op: "remove", who: o.key, deps })),
      )
    ).sort((a, b) => (a.sig < b.sig ? -1 : 1));
    expect(await r0.add([removal])).toMatchObject({ added: 1 });
    const kc = await commitEpoch(newEpochSecret(seededBytes(51)), ROOM, 1);
    const next = await signStart(host, ROOM, { epoch: 1, kc, prev: removal.sig });
    // After the start: it stays placed.
    await chain.addStarts([next]);
    await r0.add([fork]);
    expect(r0.state().removal?.sig).toBe(fork.sig);
    expect(chain.deepest()?.sig).toBe(next.sig);
    const members = [...chain.rosterOf(next)!.state().members].sort();
    // Before the start (a fresh chain, the fork first), and in a reload of the record: the same line, the same roster.
    for (const order of ["fork first", "record"] as const) {
      const other = new EpochChain(host.key, ROOM);
      const data = chain.data(next);
      if (order === "fork first") {
        await other.addStarts([start]);
        await other
          .rosterOf(start)!
          .add([...data.logs[0].entries.filter((e) => (e as { sig: string }).sig !== removal.sig)]);
        await other.add(data);
      } else await other.add(JSON.parse(JSON.stringify(data)));
      expect(other.validated().map((st) => st.sig)).toEqual([start.sig, next.sig]);
      expect([...other.rosterOf(next)!.state().members].sort()).toEqual(members);
    }
  });

  it("handing the room over hands Remove over: the new host's removal counts, the old host's doesn't", async () => {
    const [host, next] = [await newIdentity(), await newIdentity()];
    const chain = new EpochChain(host.key, ROOM);
    const start = await startOf(host, newEpochSecret(seededBytes(7)));
    await chain.addStarts([start]);
    const r0 = chain.rosterOf(start)!;
    const others = [await newIdentity(), await newIdentity()];
    for (const who of [next, ...others]) await r0.append(host, "join", { who: who.key, x: (await newAgreement()).x });
    await r0.append(host, "host", { who: next.key });
    expect(r0.state().host).toBe(next.key);
    expect(await r0.append(host, "remove", { who: others[0].key })).toBeUndefined();
    const removal = (await r0.append(next, "remove", { who: others[1].key }))!;
    expect(removal).toBeDefined();
    const kc = await commitEpoch(newEpochSecret(seededBytes(8)), ROOM, 1);
    await chain.addStarts([await signStart(host, ROOM, { epoch: 1, kc, prev: removal.sig })]);
    expect(chain.validated()).toHaveLength(1);
    const real = await signStart(next, ROOM, { epoch: 1, kc, prev: removal.sig });
    await chain.addStarts([real]);
    expect(chain.deepest()?.sig).toBe(real.sig);
    expect(chain.rosterOf(real)!.state().host).toBe(next.key);
  });

  it("round-trips every supported epoch: a chain through epoch 31 comes back in full, its membership with it", async () => {
    const host = await newIdentity();
    const stays = await newIdentity();
    const chain = new EpochChain(host.key, ROOM);
    let start = await startOf(host, newEpochSecret(seededBytes(40)));
    await chain.addStarts([start]);
    await chain.rosterOf(start)!.append(host, "join", { who: stays.key, x: (await newAgreement()).x });
    for (let epoch = 1; epoch < MAX_EPOCHS; epoch++) {
      const roster = chain.rosterOf(start)!;
      const goes = await newIdentity();
      await roster.append(host, "join", { who: goes.key, x: (await newAgreement()).x });
      const removal = (await roster.append(host, "remove", { who: goes.key }))!;
      const secret = newEpochSecret(seededBytes(40 + epoch));
      const next = await signStart(host, ROOM, {
        epoch,
        kc: await commitEpoch(secret, ROOM, epoch),
        prev: removal.sig,
      });
      await chain.addStarts([next]);
      expect(chain.rosterOf(next)).toBeDefined();
      start = next;
      // What a member keeps (or a bundle carries), taken by a page that has nothing yet.
      const again = new EpochChain(host.key, ROOM);
      await again.add(chain.data(start));
      expect(again.deepest()?.sig).toBe(start.sig);
      expect(again.deepest()?.epoch).toBe(epoch);
      expect(again.validated()).toHaveLength(epoch + 1);
      expect([...again.rosterOf(start)!.state().members].sort()).toEqual([host.key, stays.key].sort());
      expect(again.rosterOf(start)!.state().members.has(goes.key)).toBe(false);
    }
    expect(start.epoch).toBe(MAX_EPOCHS - 1);
  }, 60_000);

  it("a bundle tells the chain's listeners once, and only when it changed something", async () => {
    const host = await newIdentity();
    const chain = new EpochChain(host.key, ROOM);
    const start = await startOf(host, newEpochSecret(seededBytes(30)));
    await chain.addStarts([start]);
    const r0 = chain.rosterOf(start)!;
    for (let i = 0; i < 3; i++)
      await r0.append(host, "join", { who: (await newIdentity()).key, x: (await newAgreement()).x });
    const data = chain.data(start);
    let told = 0;
    chain.subscribe(() => told++);
    for (let i = 0; i < 256; i++) await chain.add({ starts: [], logs: [] });
    await chain.add(data);
    expect(told).toBe(0);
    // A bundle with something new: told once, however much it carried.
    const other = new EpochChain(host.key, ROOM);
    let otherTold = 0;
    other.subscribe(() => otherTold++);
    await other.add(data);
    expect(otherTold).toBe(1);
  });

  it("starts are checked in full", async () => {
    const host = await newIdentity();
    const start = await startOf(host, newEpochSecret(seededBytes(6)));
    expect(parseStart(start)).toEqual(start);
    expect(parseStart({ ...start, epoch: -1 })).toBeUndefined();
    expect(parseStart({ ...start, prev: start.sig })).toBeUndefined();
    expect(parseStart({ ...start, x: undefined })).toBeUndefined();
    expect(parseStart({ ...start, extra: 1 })).toBeUndefined();
  });
});

describe("the roster's membership (knock-to-join)", () => {
  it("roles name members only; the host can't be removed; a removal takes its roles with it, driving included", async () => {
    const [host, wren, otter] = [await newIdentity(), await newIdentity(), await newIdentity()];
    const r = new SignedRoster(host.key, ROOM, "0:x", { base: rootState(host.key, "x".repeat(43)), knock: true });
    expect(await r.append(host, "admit", { who: wren.key })).toBeUndefined();
    await r.append(host, "join", { who: wren.key, x: "w".repeat(43) });
    await r.append(host, "join", { who: otter.key, x: "o".repeat(43) });
    await r.append(host, "cohost", { who: wren.key });
    await r.append(host, "drive", { who: wren.key });
    expect(await r.append(wren, "remove", { who: host.key })).toBeUndefined();
    expect(await r.append(otter, "remove", { who: wren.key })).toBeUndefined();
    expect(await r.append(host, "remove", { who: wren.key })).toBeDefined();
    const next = afterRemoval(r.state());
    expect(next.members.has(wren.key)).toBe(false);
    expect(next.cohosts).toEqual([]);
    expect(next.driver).toBeUndefined();
    expect(next.xs.has(wren.key)).toBe(false);
    expect(r.next()?.members.has(otter.key)).toBe(true);
  });

  it("a room without knock-to-join has no membership entries", async () => {
    const [host, wren] = [await newIdentity(), await newIdentity()];
    const r = new SignedRoster(host.key, ROOM, 0);
    expect(await r.append(host, "join", { who: wren.key, x: "w".repeat(43) })).toBeUndefined();
    expect(await r.append(host, "remove", { who: wren.key })).toBeUndefined();
  });
});

describe("the lobby", () => {
  it("wraps an epoch's secret for one member: only they unwrap it, and only for that room, epoch and wrapper", async () => {
    const [host, wren, otter] = [await newIdentity(), await newIdentity(), await newIdentity()];
    const [ha, wa, oa] = [await newAgreement(), await newAgreement(), await newAgreement()];
    const secret = newEpochSecret(seededBytes(7));
    const wrap = await wrapFor(ROOM, "0:s", { identity: host, agreement: ha }, { key: wren.key, x: wa.x }, secret);
    expect([...(await unwrap(ROOM, wrap, { key: wren.key, agreement: wa }))!]).toEqual([...secret]);
    expect(await unwrap(ROOM, wrap, { key: otter.key, agreement: oa })).toBeUndefined();
    expect(await unwrap(ROOM, { ...wrap, to: otter.key }, { key: otter.key, agreement: oa })).toBeUndefined();
    expect(await unwrap("another-room", wrap, { key: wren.key, agreement: wa })).toBeUndefined();
    expect(await unwrap(ROOM, { ...wrap, scope: "1:s" }, { key: wren.key, agreement: wa })).toBeUndefined();
  });

  it("two sender ids from someone at the door can't block a member's fragmented bundle (a lobby's own small limits)", async () => {
    const host = await newIdentity();
    const keys = await deriveRoomKeys({ epoch: 0, secret: seededBytes(11)(32), hostKey: host.key, knock: true });
    const clock = new FakeClock();
    // The newcomer's page, at the door: the room's host is the one member it knows.
    const door = new Lobby(keys, await newIdentity(), seededBytes(12)(16), clock);
    door.isMember = (key) => key === host.key;
    // Someone with the link: two sender ids, each declaring messages far past a lobby message's size, then as many
    // first fragments of a message just under it as they're let keep.
    const evil = await newIdentity();
    const part = (lobby: Lobby, length: number, id: number) => {
      const size = COLLAB_LIMITS.maxFragmentBytes;
      const body = new Uint8Array(1 + 12 + size);
      const view = new DataView(body.buffer);
      body[0] = LOBBY.fragment;
      view.setUint32(1, id);
      view.setUint16(5, 0);
      view.setUint16(7, Math.ceil(length / size));
      view.setUint32(9, length);
      const plain = new Uint8Array(body.length + 32);
      plain.set(body);
      plain.set(base64UrlToBytes(evil.key), body.length);
      return (lobby as unknown as { sealer: { seal(c: "lobby", p: Uint8Array): Promise<Uint8Array> } }).sealer.seal(
        "lobby",
        plain,
      );
    };
    let refusedLarge = 0;
    let kept = 0;
    for (let i = 0; i < 2; i++) {
      const lobby = new Lobby(keys, evil, seededBytes(20 + i)(16), clock);
      expect(await door.open("evil", await part(lobby, 32 * 1024 * 1024, 1))).toBeUndefined();
      if (door.refused === "too-large") refusedLarge++;
      for (let id = 2; id < 6; id++) {
        expect(await door.open("evil", await part(lobby, MAX_LOBBY_MESSAGE_BYTES, id))).toBeUndefined();
        if (door.refused === undefined) kept++;
      }
    }
    expect(refusedLarge).toBe(2);
    expect(kept).toBeGreaterThan(0);
    // The host's bundle, larger than a frame: it's put back together and taken.
    const host1 = new Lobby(keys, host, seededBytes(13)(16), clock);
    const big = {
      t: "bundle" as const,
      chain: { starts: [], logs: [{ scope: "0:x", entries: ["y".repeat(2_500_000)] }] },
      wraps: [],
    };
    const frames = await host1.seal(big);
    expect(frames.length).toBeGreaterThan(1);
    let got;
    for (const f of frames) got = await door.open("host", f);
    expect(door.refused).toBeUndefined();
    expect(got?.body.t).toBe("bundle");
    expect(got?.key).toBe(host.key);
  });

  it("checks every message: its signature (bound to its sender id), and its shape", async () => {
    const host = await newIdentity();
    const keys = await deriveRoomKeys({ epoch: 0, secret: seededBytes(8)(32), hostKey: host.key, knock: true });
    const clock = new FakeClock();
    const a = new Lobby(keys, host, seededBytes(9)(16), clock);
    const b = new Lobby(keys, await newIdentity(), seededBytes(10)(16), clock);
    const [frame] = await a.seal({ t: "hello", x: "x".repeat(43), alias: "Heron" });
    const m = await b.open("peer", frame);
    expect(m?.key).toBe(host.key);
    expect(m?.body).toEqual({ t: "hello", x: "x".repeat(43), alias: "Heron" });
    expect(parseBody({ t: "hello", x: "short", alias: "" })).toBeUndefined();
    expect(parseBody({ t: "hello", x: "x".repeat(43), alias: "", scope: "0:s" })).toBeUndefined();
    expect(parseBody({ t: "bundle", chain: { starts: [], logs: [] }, wraps: [{ scope: "0:s" }] })).toBeUndefined();
    expect(parseBody({ t: "remove" })).toBeUndefined();
  });
});
