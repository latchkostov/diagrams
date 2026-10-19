import { describe, expect, it } from "vitest";
import { bytesToBase64Url, base64UrlToBytes } from "../interop/codec";
import { fold, MAX_ENTRIES_PER_SIGNER, parseEntry, signEntry, SignedRoster, type RosterEntry } from "./roster";
import { newIdentity, type Identity } from "./signing";
import { seededRandom } from "./random";

const ROOM = "room-id-for-tests";

async function people(n: number): Promise<Identity[]> {
  return Promise.all(Array.from({ length: n }, () => newIdentity()));
}

/** A roster as `host`'s room has it, and a second copy that gets the same entries in another order. */
const roster = (host: Identity, epoch = 0) => new SignedRoster(host.key, ROOM, epoch);

describe("the signed roster", () => {
  it("starts with the link's host key: the host edits, hosts and drives", async () => {
    const [host, wren] = await people(2);
    const s = roster(host).state();
    expect(s.host).toBe(host.key);
    expect([...s.editors]).toEqual([host.key]);
    expect(s.driver).toBeUndefined();
    expect(s.viewOnly).toBe(false);
    expect(s.editors.has(wren.key)).toBe(false);
  });

  it("the host's grants count: admit, co-host, drive, policy", async () => {
    const [host, wren, otter] = await people(3);
    const r = roster(host);
    expect(await r.append(host, "admit", { who: wren.key })).toBeDefined();
    expect(await r.append(host, "cohost", { who: otter.key })).toBeDefined();
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
    const own = await signEntry(mallory, ROOM, 0, { n: 2, op: "cohost", who: mallory.key });
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

  it("refuses malformed entries before any verification", async () => {
    const [host] = await people(1);
    const r = roster(host);
    const bad = [
      null,
      [],
      { n: 1, by: host.key, op: "admit", sig: "x".repeat(86) },
      { n: 0, by: host.key, op: "admit", who: host.key, sig: "x".repeat(86) },
      { n: 1, by: host.key, op: "remove", who: host.key, sig: "x".repeat(86) },
      { n: 1, by: host.key, op: "policy", sig: "x".repeat(86) },
      { n: 1, by: host.key, op: "admit", who: host.key, sig: "x".repeat(86), extra: 1 },
    ];
    let checks = 0;
    expect(await r.add(bad, () => (checks++, true))).toMatchObject({ added: 0, refused: bad.length });
    expect(checks).toBe(0);
    expect(bad.map(parseEntry).every((e) => e === undefined)).toBe(true);
  });

  it("someone who can't edit gets nothing kept; an editor who isn't a co-host changes no roles", async () => {
    const [host, wren, viewer] = await people(3);
    const r = roster(host);
    await r.append(host, "admit", { who: wren.key });
    // A viewer's entries (signed, but by someone who can't edit) aren't kept at all.
    const self = await signEntry(viewer, ROOM, 0, { n: 5, op: "cohost", who: viewer.key });
    expect(await r.add([self])).toMatchObject({ added: 0, refused: 1 });
    // An editor's co-host entry is kept (it may yet sort before a grant) but changes nothing.
    const made = await signEntry(wren, ROOM, 0, { n: 5, op: "cohost", who: wren.key });
    expect(await r.add([made])).toMatchObject({ added: 1 });
    expect(r.state().cohosts).toEqual([]);
    expect(r.may(wren.key, "cohost")).toBe(false);
    expect(r.may(wren.key, "admit")).toBe(true);
  });

  it("while new people can only view, only the host and co-hosts admit", async () => {
    const [host, wren, otter, newt] = await people(4);
    const r = roster(host);
    await r.append(host, "admit", { who: wren.key });
    await r.append(host, "cohost", { who: otter.key });
    await r.append(host, "policy", { viewOnly: true });
    expect(r.may(wren.key, "admit")).toBe(false);
    expect(await r.append(wren, "admit", { who: newt.key })).toBeUndefined();
    expect(await r.append(otter, "admit", { who: newt.key })).toBeDefined();
    expect(r.state().editors.has(newt.key)).toBe(true);
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
    // Two sides of a partition, each with the host's early grants, then each its own concurrent changes.
    const left = roster(host);
    await left.append(host, "cohost", { who: a.key });
    await left.append(host, "admit", { who: b.key });
    const right = roster(host);
    await right.add(left.log());
    await left.append(host, "drive", { who: b.key });
    await left.append(a, "cohost", { who: c.key });
    await right.append(a, "drive", { who: a.key });
    await right.append(a, "uncohost", { who: a.key });
    await right.append(host, "admit", { who: d.key });
    const all = [...left.log(), ...right.log()];
    const random = seededRandom(7);
    const results = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const r = roster(host);
        const shuffled = [...all].sort(() => random() - 0.5);
        // In pieces, as peers would send them; an entry whose signer couldn't edit yet when it came is kept once it's
        // sent again (a roster summary that differs asks for the whole roster).
        await r.add(shuffled.slice(0, 3));
        await r.add(shuffled.slice(3));
        await r.add(shuffled);
        const s = r.state();
        return JSON.stringify([s.host, s.cohosts, [...s.editors].sort(), s.driver, s.viewOnly]);
      }),
    );
    expect(new Set(results).size).toBe(1);
    // The same as folding the entries directly.
    const s = fold(host.key, all);
    expect(results[0]).toBe(JSON.stringify([s.host, s.cohosts, [...s.editors].sort(), s.driver, s.viewOnly]));
  });

  it("is bounded: one signer's entries, and entries that would change nothing aren't made", async () => {
    const [host] = await people(1);
    const others = await people(3);
    const r = roster(host);
    expect(await r.append(host, "policy", { viewOnly: false })).toBeUndefined();
    await r.append(host, "admit", { who: others[0].key });
    expect(await r.append(host, "admit", { who: others[0].key })).toBeUndefined();
    // Drive changes back and forth, up to the signer's bound.
    let made = r.size;
    for (let i = 0; made < MAX_ENTRIES_PER_SIGNER; i++)
      if (await r.append(host, "drive", { who: i % 2 ? host.key : others[0].key })) made++;
    expect(r.size).toBe(MAX_ENTRIES_PER_SIGNER);
    expect(await r.append(host, "admit", { who: others[1].key })).toBeUndefined();
  }, 30_000);

  it("verifies each entry once, within the budget it's given: the rest are left for when they're sent again", async () => {
    const [host, ...rest] = await people(5);
    const source = roster(host);
    for (const p of rest) await source.append(host, "admit", { who: p.key });
    const r = roster(host);
    let budget = 2;
    expect(await r.add(source.log(), () => budget-- > 0)).toMatchObject({ added: 2, throttled: 2 });
    let checks = 0;
    // Sent again: the two kept aren't verified again.
    expect(await r.add(source.log(), () => (checks++, true))).toMatchObject({ added: 2, throttled: 0 });
    expect(checks).toBe(2);
  });
});
