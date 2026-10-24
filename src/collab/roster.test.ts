import { describe, expect, it } from "vitest";
import { bytesToBase64Url, base64UrlToBytes } from "../interop/codec";
import {
  fold,
  MAX_ENTRIES_PER_SIGNER,
  MAX_FORKS_PER_SIGNER,
  MAX_PENDING,
  MAX_ROSTER_ENTRIES,
  parseEntry,
  signEntry,
  SignedRoster,
  VerifiedRosterEntry,
  type RosterEntry,
  type RosterOp,
} from "./roster";
import { newIdentity, type Identity } from "./signing";
import { seededRandom } from "./random";

const ROOM = "room-id-for-tests";

async function people(n: number): Promise<Identity[]> {
  return Promise.all(Array.from({ length: n }, () => newIdentity()));
}

const roster = (host: Identity, epoch = 0) => new SignedRoster(host.key, ROOM, epoch);

/** Another peer's copy of `from`'s roster (as it would get it on joining). */
async function copyOf(from: SignedRoster): Promise<SignedRoster> {
  const r = new SignedRoster(from.hostKey, ROOM, from.epoch);
  await r.add(from.log());
  return r;
}

/** An entry by `who` on exactly `deps` (a signer claiming to have seen only those), its counter its past's. */
async function on(
  r: SignedRoster,
  signer: Identity,
  op: RosterOp,
  fields: { who?: string; viewOnly?: boolean },
  deps: string[],
): Promise<RosterEntry> {
  const byId = new Map(r.log().map((e) => [e.sig, e]));
  const n = 1 + Math.max(0, ...deps.map((d) => byId.get(d)!.n));
  return signEntry(signer, ROOM, r.epoch, { n, op, ...fields, deps });
}

describe("the signed roster", () => {
  it("keeps verified authority opaque and frozen, including across an in-flight verification", async () => {
    const [host, guest] = await people(2);
    const r = roster(host);
    const entry = await signEntry(host, ROOM, 0, { n: 1, op: "admit", who: guest.key, deps: [] });
    const verifying = VerifiedRosterEntry.verify(entry, ROOM, 0);
    entry.who = host.key;
    (entry.deps as string[]).push("unchecked");
    const verified = (await verifying)!;
    expect(verified.entry.who).toBe(guest.key);
    expect(verified.entry.deps).toEqual([]);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.entry)).toBe(true);
    expect(Object.isFrozen(verified.entry.deps)).toBe(true);
    expect(() => Object.assign(verified.entry, { who: host.key })).toThrow(TypeError);
    expect(() => Object.assign(verified, { roomId: "other" })).toThrow(TypeError);
    expect(() => (verified.entry.deps as string[]).push("unchecked")).toThrow(TypeError);
    const forged = { entry: verified.entry, roomId: ROOM, scope: 0 };
    // @ts-expect-error Unchecked structural objects must not carry verification authority.
    expect(r.addVerified([forged])).toMatchObject({ added: 0, refused: 1 });
    expect(r.addVerified([Object.create(VerifiedRosterEntry.prototype) as VerifiedRosterEntry])).toMatchObject({
      added: 0,
      refused: 1,
    });
    expect(r.addVerified([verified])).toMatchObject({ added: 1, refused: 0 });
    expect(r.state().editors.has(guest.key)).toBe(true);
    expect(roster(host, 1).addVerified([verified])).toMatchObject({ added: 0, refused: 1 });
    expect(new SignedRoster(host.key, "other", 0).addVerified([verified])).toMatchObject({ added: 0, refused: 1 });
  });
  it("starts with the link's host key: the host edits, hosts and drives", async () => {
    const [host, wren] = await people(2);
    const s = roster(host).state();
    expect(s.host).toBe(host.key);
    expect([...s.editors]).toEqual([host.key]);
    expect(s.driver).toBeUndefined();
    expect(s.viewOnly).toBe(false);
    expect(s.editors.has(wren.key)).toBe(false);
  });

  it("the host's grants count: admit, co-host, drive, policy, each on the entries before it", async () => {
    const [host, wren, otter] = await people(3);
    const r = roster(host);
    const first = (await r.append(host, "admit", { who: wren.key }))!;
    expect(first).toMatchObject({ n: 1, deps: [] });
    const second = (await r.append(host, "cohost", { who: otter.key }))!;
    expect(second).toMatchObject({ n: 2, deps: [first.sig] });
    expect(await r.append(host, "drive", { who: wren.key })).toBeDefined();
    expect(await r.append(host, "policy", { viewOnly: true })).toBeDefined();
    const s = r.state();
    expect([...s.editors].sort()).toEqual([host.key, wren.key, otter.key].sort());
    expect(s.cohosts).toEqual([otter.key]);
    expect(s.driver).toBe(wren.key);
    expect(s.viewOnly).toBe(true);
    // Taking Live back: the host's own key.
    await r.append(host, "drive", { who: host.key });
    expect(r.state().driver).toBeUndefined();
  });

  it("a forged entry is refused: another key's signature, a changed field, another room or epoch", async () => {
    const [host, mallory, wren] = await people(3);
    const r = roster(host);
    const genuine = (await r.append(host, "admit", { who: wren.key }))!;
    const target = roster(host);
    // Mallory signs an entry claiming to be the host's.
    const own = await signEntry(mallory, ROOM, 0, { n: 1, op: "cohost", who: mallory.key, deps: [] });
    const claimed: RosterEntry = { ...own, by: host.key };
    // The host's genuine entry, with its subject changed.
    const changed: RosterEntry = { ...genuine, who: mallory.key };
    // A signature bent by one bit.
    const sig = base64UrlToBytes(genuine.sig);
    sig[10] ^= 1;
    const bent: RosterEntry = { ...genuine, sig: bytesToBase64Url(sig) };
    expect(await target.add([claimed, changed, bent])).toMatchObject({ added: 0, refused: 3 });
    // The genuine entry from another room, or another epoch, doesn't verify there.
    expect(await new SignedRoster(host.key, "another-room", 0).add([genuine])).toMatchObject({ added: 0, refused: 1 });
    expect(await roster(host, 1).add([genuine])).toMatchObject({ added: 0, refused: 1 });
    expect(target.state().editors.has(mallory.key)).toBe(false);
    expect(await target.add([genuine])).toMatchObject({ added: 1, refused: 0 });
    expect(target.state().editors.has(wren.key)).toBe(true);
  });

  it("one signature has one spelling: aliases (its unused bits set) are refused, so they can't fill a quota", async () => {
    const [host, wren] = await people(2);
    const genuine = (await roster(host).append(host, "admit", { who: wren.key }))!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(genuine.sig.at(-1)!);
    // The 86th character carries 6 bits, of which 2 are data: 15 other spellings decode to the same bytes.
    const aliases = Array.from({ length: 4 }, (_, i) => alphabet[(last & ~3) | i])
      .concat(Array.from({ length: 4 }, (_, i) => alphabet[(last & ~15) | (i << 2) | (last & 3)]))
      .filter((c) => c !== genuine.sig.at(-1))
      .map((c) => ({ ...genuine, sig: genuine.sig.slice(0, 85) + c }));
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) expect([...base64UrlToBytes(alias.sig)]).toEqual([...base64UrlToBytes(genuine.sig)]);
    const target = roster(host);
    expect(await target.add([...aliases, genuine])).toMatchObject({ added: 1, refused: aliases.length });
    expect(target.size).toBe(1);
  });

  it("refuses malformed entries before any verification", async () => {
    const [host] = await people(1);
    const r = roster(host);
    const sig = "x".repeat(86);
    const bad = [
      null,
      [],
      { n: 1, by: host.key, op: "admit", deps: [], sig },
      { n: 0, by: host.key, op: "admit", who: host.key, deps: [], sig },
      { n: 1, by: host.key, op: "remove", who: host.key, deps: [], sig },
      { n: 1, by: host.key, op: "policy", deps: [], sig },
      { n: 1, by: host.key, op: "admit", who: host.key, sig },
      { n: 1, by: host.key, op: "admit", who: host.key, deps: ["b", "a"], sig },
      { n: 1, by: host.key, op: "admit", who: host.key, deps: [], sig, extra: 1 },
    ];
    let checks = 0;
    expect(await r.add(bad, () => (checks++, true))).toMatchObject({ added: 0, refused: bad.length });
    expect(checks).toBe(0);
    expect(bad.map(parseEntry).every((e) => e === undefined)).toBe(true);
  });

  it("a counter that isn't its past's is refused (an entry can't sort before what it saw)", async () => {
    const [host, wren, otter] = await people(3);
    const r = roster(host);
    const first = (await r.append(host, "admit", { who: wren.key }))!;
    const early = await signEntry(host, ROOM, 0, { n: 1, op: "admit", who: otter.key, deps: [first.sig] });
    expect(await r.add([early])).toMatchObject({ added: 0, refused: 1 });
  });

  it("only the host and co-hosts admit: an editor's admission never counts, and a viewer's entries aren't kept", async () => {
    const [host, wren, viewer, newt] = await people(4);
    const r = roster(host);
    const admitted = (await r.append(host, "admit", { who: wren.key }))!;
    expect(r.may(wren.key, "admit")).toBe(false);
    expect(await r.add([await on(r, wren, "admit", { who: newt.key }, [admitted.sig])])).toMatchObject({
      added: 0,
      refused: 1,
    });
    expect(await r.add([await on(r, viewer, "cohost", { who: viewer.key }, [admitted.sig])])).toMatchObject({
      added: 0,
      refused: 1,
    });
    expect([...r.state().editors].sort()).toEqual([host.key, wren.key].sort());
  });

  it("a backdated admission can't get round 'view only': it would need host or co-host authority it never had", async () => {
    // The review's case: the host admits an editor, changes the driver, then turns on view only; the editor signs an
    // admission claiming to have seen only its own admission (sorting before the switch).
    const [host, editor, viewer] = await people(3);
    const r = roster(host);
    const admitted = (await r.append(host, "admit", { who: editor.key }))!;
    await r.append(host, "drive", { who: editor.key });
    await r.append(host, "policy", { viewOnly: true });
    const backdated = await on(r, editor, "admit", { who: viewer.key }, [admitted.sig]);
    expect(backdated.n).toBe(2);
    expect(await r.add([backdated])).toMatchObject({ added: 0, refused: 1 });
    expect(r.state().editors.has(viewer.key)).toBe(false);
  });

  it("an admission concurrent with its admitter's 'Not a co-host' stays: what counted counts for good", async () => {
    const [first, second, newt] = await people(3);
    const authorOrders = new Set<string>();
    for (const [host, cohost] of [
      [first, second],
      [second, first],
    ]) {
      const base = roster(host);
      const made = (await base.append(host, "cohost", { who: cohost.key }))!;
      // A partition: the co-host admits a newcomer on one side; the host takes the co-hosting back on the other.
      const side = await copyOf(base);
      const admission = (await side.append(cohost, "admit", { who: newt.key }))!;
      expect(side.state().editors.has(newt.key)).toBe(true);
      const revoked = (await base.append(host, "uncohost", { who: cohost.key }))!;
      // Reverse the two roles as well, so both same-counter author orders are always exercised.
      expect(await side.add([revoked])).toMatchObject({ added: 1 });
      const sameCounter = side.log().filter((entry) => entry.n === revoked.n);
      authorOrders.add(sameCounter[0].by === host.key ? "revocation-first" : "admission-first");
      expect(side.state().editors.has(newt.key)).toBe(true);
      expect(side.state().cohosts).toEqual([]);
      // The host's side, in either order.
      expect(await base.add([admission])).toMatchObject({ added: 1 });
      expect(base.state().editors.has(newt.key)).toBe(true);
      expect(made.n).toBe(1);
      // A fresh admission by the former co-host, on the revocation, doesn't count.
      expect(await base.add([await on(base, cohost, "admit", { who: host.key }, base.heads())])).toMatchObject({
        refused: 1,
      });
    }
    expect(authorOrders).toEqual(new Set(["revocation-first", "admission-first"]));
  });

  it("an admission concurrent with turning on 'view only' stays: a co-host may admit, and it counted when made", async () => {
    const [host, cohost, newt] = await people(3);
    const base = roster(host);
    await base.append(host, "cohost", { who: cohost.key });
    const side = await copyOf(base);
    const admission = (await side.append(cohost, "admit", { who: newt.key }))!;
    const policy = (await base.append(host, "policy", { viewOnly: true }))!;
    for (const [r, entry] of [
      [side, policy],
      [base, admission],
    ] as const) {
      expect(await r.add([entry])).toMatchObject({ added: 1 });
      expect(r.state().editors.has(newt.key)).toBe(true);
      expect(r.state().viewOnly).toBe(true);
    }
  });

  it("an entry waits for its past, and counts once it's here", async () => {
    const [host, wren, otter] = await people(3);
    const source = roster(host);
    const first = (await source.append(host, "admit", { who: wren.key }))!;
    const second = (await source.append(host, "admit", { who: otter.key }))!;
    const r = roster(host);
    expect(await r.add([second])).toMatchObject({ added: 0, waiting: 1 });
    expect(await r.add([first])).toMatchObject({ added: 2 });
    expect(r.has(second.sig)).toBe(true);
  });

  it("a handover: the new host hosts, the old one is the first co-host, and Live stays as it was", async () => {
    const [host, wren, otter] = await people(3);
    const r = roster(host);
    await r.append(host, "cohost", { who: otter.key });
    await r.append(host, "admit", { who: wren.key });
    await r.append(host, "host", { who: wren.key });
    const s = r.state();
    expect(s.host).toBe(wren.key);
    expect(s.cohosts).toEqual([host.key, otter.key]);
    // The old host drove (no driver): it still does, by its key.
    expect(s.driver).toBe(host.key);
    // Only the host hands the room on; the old host can't take it back.
    expect(await r.append(host, "host", { who: host.key })).toBeUndefined();
    expect(await r.append(wren, "drive", { who: wren.key })).toBeDefined();
    expect(r.state().driver).toBeUndefined();
  });

  it("every peer folds the same roles from the same entries, whatever order they came in (a partition merges)", async () => {
    const [host, a, b, c, d] = await people(5);
    const left = roster(host);
    await left.append(host, "cohost", { who: a.key });
    await left.append(host, "admit", { who: b.key });
    const right = await copyOf(left);
    // Each side its own signers (one person is on one side; a key on both would be a fork: below).
    await left.append(host, "drive", { who: b.key });
    await left.append(host, "cohost", { who: c.key });
    await right.append(a, "drive", { who: a.key });
    await right.append(a, "admit", { who: d.key });
    await right.append(a, "uncohost", { who: a.key });
    const all = [...left.log(), ...right.log()];
    const random = seededRandom(7);
    const results = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const r = roster(host);
        const shuffled = [...all].sort(() => random() - 0.5);
        // In pieces, as peers would send them: an entry waits for its past.
        await r.add(shuffled.slice(0, 3));
        await r.add(shuffled.slice(3));
        const s = r.state();
        return JSON.stringify([s.host, s.cohosts, [...s.editors].sort(), s.driver, s.viewOnly, r.size]);
      }),
    );
    expect(new Set(results).size).toBe(1);
    const s = fold(host.key, all);
    expect(results[0]).toBe(
      JSON.stringify([
        s.host,
        s.cohosts,
        [...s.editors].sort(),
        s.driver,
        s.viewOnly,
        new Set(all.map((e) => e.sig)).size,
      ]),
    );
  });

  it("is bounded: one signer's entries, and entries that would change nothing aren't made", async () => {
    const [host] = await people(1);
    const others = await people(3);
    const r = roster(host);
    expect(await r.append(host, "policy", { viewOnly: false })).toBeUndefined();
    await r.append(host, "admit", { who: others[0].key });
    expect(await r.append(host, "admit", { who: others[0].key })).toBeUndefined();
    let made = r.size;
    for (let i = 0; made < MAX_ENTRIES_PER_SIGNER; i++)
      if (await r.append(host, "drive", { who: i % 2 ? host.key : others[0].key })) made++;
    expect(r.size).toBe(MAX_ENTRIES_PER_SIGNER);
    expect(await r.append(host, "admit", { who: others[1].key })).toBeUndefined();
  }, 60_000);

  it("imports and restores a roster larger than MAX_PENDING: the same log and roles after import, reload and replay", async () => {
    const [host, cohost, wren] = await people(3);
    const source = roster(host);
    await source.append(host, "cohost", { who: cohost.key });
    await source.append(host, "admit", { who: wren.key });
    // Two signers' drive changes, back and forth: a chain longer than the waiting bound.
    for (let i = 0; source.size <= MAX_PENDING + 10; i++) {
      const signer = i % 3 ? cohost : host;
      await source.append(signer, "drive", { who: i % 2 ? wren.key : cohost.key });
    }
    expect(source.size).toBeGreaterThan(MAX_PENDING);
    const facts = (r: SignedRoster) => {
      const s = r.state();
      return JSON.stringify([r.log(), s.host, s.cohosts, [...s.editors].sort(), s.driver, s.viewOnly]);
    };
    // A newcomer's import (the whole log in one message), however it's ordered.
    const imported = roster(host);
    expect(await imported.add([...source.log()].reverse())).toMatchObject({ added: source.size, waiting: 0 });
    expect(facts(imported)).toBe(facts(source));
    // A reload: the record's log (JSON) into a fresh roster.
    const reloaded = roster(host);
    await reloaded.add(JSON.parse(JSON.stringify(imported.log())));
    expect(facts(reloaded)).toBe(facts(source));
    // Replayed (anti-entropy sends it again): nothing changes, nothing is verified again.
    let checks = 0;
    expect(await reloaded.add(source.log(), () => (checks++, true))).toMatchObject({ added: 0, refused: 0 });
    expect(checks).toBe(0);
    expect(facts(reloaded)).toBe(facts(source));
  }, 60_000);

  it("a revoked co-host's flood of sibling entries takes one slot: the host can still act, and every peer agrees", async () => {
    const [host, cohost] = await people(2);
    const base = roster(host);
    const granted = (await base.append(host, "cohost", { who: cohost.key }))!;
    await base.append(host, "uncohost", { who: cohost.key });
    // Siblings on the grant (each claims to predate the revocation): many admissions, one slot.
    const keys = Array.from({ length: MAX_ROSTER_ENTRIES }, (_, i) =>
      bytesToBase64Url(Uint8Array.from({ length: 32 }, (_, j) => (i * 31 + j * 7 + (i >> 8)) & 255)),
    );
    const flood = await Promise.all(
      keys.map((who) => signEntry(cohost, ROOM, 0, { n: 2, op: "admit", who, deps: [granted.sig] })),
    );
    await base.add(flood);
    const byCohost = base.log().filter((e) => e.by === cohost.key);
    expect(base.size).toBe(3);
    expect(byCohost.length).toBeLessThanOrEqual(1 + MAX_FORKS_PER_SIGNER);
    expect([...base.state().editors].filter((k) => keys.includes(k))).toHaveLength(1);
    // The host can still change the room.
    expect(await base.append(host, "policy", { viewOnly: true })).toBeDefined();
    // Another peer, the flood in another order: the same entry wins the slot.
    const other = roster(host);
    await other.add(base.log().filter((e) => e.by === host.key));
    await other.add([...flood].reverse());
    expect(other.state().editors).toEqual(base.state().editors);
    expect(other.log().filter((e) => e.by === cohost.key)[0].sig).toBe(
      base.log().filter((e) => base.has(e.sig) && e.by === cohost.key)[0].sig,
    );
  }, 120_000);

  it("verifies each entry once, within the budget it's given: the rest are left for when they're sent again", async () => {
    const [host, ...rest] = await people(5);
    const source = roster(host);
    for (const p of rest) await source.append(host, "admit", { who: p.key });
    const r = roster(host);
    let budget = 2;
    expect(await r.add(source.log(), () => budget-- > 0)).toMatchObject({ added: 2, throttled: 2 });
    let checks = 0;
    expect(await r.add(source.log(), () => (checks++, true))).toMatchObject({ added: 2, throttled: 0 });
    expect(checks).toBe(2);
  });
});
