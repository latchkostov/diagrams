import { describe, expect, it } from "vitest";
import { commitEpoch, EpochChain, parseStart, scopeOf, signStart, type EpochStart } from "./epochs";
import { newEpochSecret } from "./keys";
import { seededBytes } from "./random";
import { afterRemoval, rootState, SignedRoster } from "./roster";
import { newAgreement, newIdentity, type Identity } from "./signing";
import { Lobby, parseBody, unwrap, wrapFor } from "./lobby";
import { deriveRoomKeys } from "./keys";
import { FakeClock } from "./clock";

const ROOM = "room-id-for-tests";

async function startOf(host: Identity, secret: Uint8Array): Promise<EpochStart> {
  const x = (await newAgreement()).x;
  return signStart(host, ROOM, { epoch: 0, kc: await commitEpoch(secret, ROOM, 0), x });
}

describe("epochs", () => {
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

  it("a later epoch's start counts only signed by the remover of a removal that counts in its parent", async () => {
    const [host, cohost, wren] = [await newIdentity(), await newIdentity(), await newIdentity()];
    const chain = new EpochChain(host.key, ROOM);
    const start = await startOf(host, newEpochSecret(seededBytes(4)));
    await chain.addStarts([start]);
    const r0 = chain.rosterOf(start)!;
    const [cx, wx] = [(await newAgreement()).x, (await newAgreement()).x];
    await r0.append(host, "join", { who: cohost.key, x: cx });
    await r0.append(host, "join", { who: wren.key, x: wx });
    await r0.append(host, "cohost", { who: cohost.key });
    const removal = (await r0.append(cohost, "remove", { who: wren.key }))!;
    expect(r0.state().removal?.sig).toBe(removal.sig);
    const next = newEpochSecret(seededBytes(5));
    const kc = await commitEpoch(next, ROOM, 1);
    // The host signs a start for it (not the remover): it isn't the next epoch. Nor one naming no removal of this one.
    const byHost = await signStart(host, ROOM, { epoch: 1, kc, prev: removal.sig });
    const elsewhere = await signStart(cohost, ROOM, { epoch: 1, kc, prev: start.sig });
    await chain.addStarts([byHost, elsewhere]);
    expect(chain.deepest()?.sig).toBe(start.sig);
    const real = await signStart(cohost, ROOM, { epoch: 1, kc, prev: removal.sig });
    await chain.addStarts([real]);
    expect(chain.deepest()?.sig).toBe(real.sig);
    expect(chain.parentOf(real)?.sig).toBe(start.sig);
    // The next epoch starts from this one's state without whom it removed.
    const s = chain.rosterOf(real)!.state();
    expect(s.members.has(wren.key)).toBe(false);
    expect([...s.members].sort()).toEqual([host.key, cohost.key].sort());
    expect(s.cohosts).toEqual([cohost.key]);
    // A chain from a record or a bundle gives the same.
    const again = new EpochChain(host.key, ROOM);
    await again.add(chain.data(real));
    expect(again.deepest()?.sig).toBe(real.sig);
    expect(scopeOf(again.deepest()!)).toBe(scopeOf(real));
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
