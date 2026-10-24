import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import type { ChainData } from "../epochs";
import { RELAY_ANSWER_MS, RELAY_PIECE_BYTES, RelayAdmissionController, relayPieces } from "./relayAdmission";
import type { RelayAdmission } from "./types";

/** A page's chain as a list of epochs (`entries` per epoch), and what the controller sends. */
function setUp(epochs: number[] = [2], pad = 0) {
  const clock = new FakeClock();
  const sent: { t: string; id?: number; chain?: ChainData }[] = [];
  let shape = [...epochs];
  const data = (from?: number): ChainData => {
    const all = shape.map((n, epoch) => ({
      start: { epoch, sig: `s${epoch}` },
      log: {
        scope: `${epoch}:s${epoch}`,
        entries: Array.from({ length: n }, (_, i) => ({
          sig: `e${epoch}.${i}`,
          ...(pad ? { pad: "x".repeat(pad) } : {}),
        })),
      },
    }));
    const keep = all.filter((x) => from === undefined || x.start.epoch >= from);
    return { starts: keep.map((x) => x.start), logs: keep.map((x) => x.log) } as unknown as ChainData;
  };
  const admission: RelayAdmission = {
    prove: async () => ({ key: "k", sig: "s" }),
    chain: (from) => data(from),
    tip: () => ({ epoch: shape.length - 1, entries: shape.at(-1) ?? 0 }),
    subscribe: () => () => {},
  };
  const c = new RelayAdmissionController(admission, (text) => sent.push(JSON.parse(text)), clock);
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const of = (t: string) => sent.filter((m) => m.t === t);
  return {
    admission,
    clock,
    sent,
    c,
    flush,
    of,
    set: (next: number[]) => (shape = [...next]),
  };
}

describe("a page's admission on a relay that enforces knock-to-join", () => {
  it("does not send a deferred proof after stop, an acknowledgement or a changed challenge", async () => {
    for (const state of ["stopped", "acknowledged", "replaced"] as const) {
      const t = setUp();
      const proofs: ((proof: { key: string; sig: string }) => void)[] = [];
      t.admission.prove = () => new Promise((resolve) => proofs.push(resolve));
      t.c.start("first", "0000000000000001");
      if (state === "stopped") t.c.stop();
      else if (state === "acknowledged") t.c.onProofAck(true);
      else t.c.start("second", "0000000000000002");
      proofs[0]({ key: "old", sig: "old" });
      await t.flush();
      expect(t.of("prove")).toEqual([]);
      if (state === "replaced") {
        proofs[1]({ key: "current", sig: "current" });
        await t.flush();
        expect(t.of("prove")).toMatchObject([{ key: "current", sig: "current" }]);
      }
      t.c.stop();
    }
  });

  it("preserves acknowledged piece progress across subsequent target changes", async () => {
    const t = setUp([1], 300_000);
    t.c.start("challenge", "0000000000000001");
    await t.flush();
    const latest = () => t.of("chain").at(-1)!;
    const acknowledge = () => t.c.onChainAck({ id: latest().id!, complete: true });
    acknowledge();
    t.set([1, 1, 1, 1]);
    t.c.changed();
    acknowledge(); // epoch 0
    acknowledge(); // epoch 1
    t.set([1, 1, 1, 2]);
    t.c.changed();
    expect(latest().chain?.starts).toEqual([{ epoch: 2, sig: "s2" }]);
    acknowledge();
    const entries: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      entries.push(...latest().chain!.logs.flatMap((log) => log.entries));
      acknowledge();
    }
    expect(entries.map((entry) => (entry as { sig: string }).sig)).toEqual(["e3.0", "e3.1"]);
    const count = t.of("chain").length;
    t.c.changed();
    expect(t.of("chain")).toHaveLength(count);
  });

  it("does not skip an incompletely acknowledged epoch when the target changes", async () => {
    const t = setUp([3, 1], 300_000);
    t.c.start("challenge", "0000000000000001");
    await t.flush();
    const latest = () => t.of("chain").at(-1)!;
    const first = latest();
    t.c.onChainAck({ id: first.id!, complete: true });
    const superseded = latest();
    t.set([3, 1, 1]);
    t.c.changed();
    const roundStart = t.of("chain").length - 1;
    t.c.onChainAck({ id: superseded.id!, complete: true });
    expect(t.of("chain")).toHaveLength(roundStart + 1);
    // An incomplete epoch is replayed from its start; every roster entry must still arrive.
    for (let i = 0; i < 5; i++) t.c.onChainAck({ id: latest().id!, complete: true });
    const sent = t.of("chain").slice(roundStart);
    expect(
      sent
        .flatMap((message) => message.chain!.logs.flatMap((log) => log.entries))
        .map((entry) => (entry as { sig: string }).sig),
    ).toEqual(["e0.0", "e0.1", "e0.2", "e1.0", "e2.0"]);
    const count = t.of("chain").length;
    t.c.changed();
    expect(t.of("chain")).toHaveLength(count);
  });
  it("proves first, and proves again (backing off) until the relay says ok, even when no answer comes", async () => {
    const t = setUp();
    t.c.start("challenge", "0000000000000001");
    await t.flush();
    expect(t.sent[0].t).toBe("prove");
    expect(t.of("chain").length).toBe(1);
    // No answer: asked again.
    t.clock.advance(RELAY_ANSWER_MS);
    t.clock.advance(1_000);
    await t.flush();
    expect(t.of("prove")).toHaveLength(2);
    // Not now: again, after a longer wait (it backs off).
    t.c.onProofAck(false);
    t.clock.advance(1_999);
    await t.flush();
    expect(t.of("prove")).toHaveLength(2);
    t.clock.advance(1);
    await t.flush();
    expect(t.of("prove")).toHaveLength(3);
    t.c.onProofAck(true);
    t.clock.advance(120_000);
    await t.flush();
    expect(t.of("prove")).toHaveLength(3);
  });

  it("pushes the chain until a push is acknowledged in full, admitted or not; then only what changed", async () => {
    const t = setUp([2, 3]);
    t.c.start("challenge", "0000000000000001");
    await t.flush();
    t.c.onProofAck(true);
    const first = t.of("chain")[0];
    expect(first.chain?.starts).toHaveLength(2);
    // Partly held (a budget): pushed again, in full.
    t.c.onChainAck({ id: first.id!, complete: false });
    t.clock.advance(1_000);
    await t.flush();
    const again = t.of("chain")[1];
    expect(again.chain?.starts).toHaveLength(2);
    t.c.onChainAck({ id: again.id!, complete: true });
    // Held: nothing more until the chain changes, however long.
    t.clock.advance(120_000);
    await t.flush();
    expect(t.of("chain")).toHaveLength(2);
    // A removal: a new epoch. Only the last held epoch on is pushed.
    t.set([2, 4, 0]);
    t.c.changed();
    const delta = t.of("chain")[2];
    expect(delta.chain?.starts.map((s) => (s as { epoch: number }).epoch)).toEqual([1, 2]);
    // No answer at all: pushed again.
    t.clock.advance(RELAY_ANSWER_MS * 2);
    t.clock.advance(1_000);
    await t.flush();
    expect(t.of("chain")).toHaveLength(4);
  });

  it("a change while a push is in flight is pushed at once; the earlier push's answer no longer counts", async () => {
    const t = setUp([1]);
    t.c.start("challenge", "0000000000000001");
    await t.flush();
    const first = t.of("chain")[0];
    t.set([2]);
    t.c.changed();
    expect(t.of("chain")).toHaveLength(2);
    expect(t.of("chain")[1].chain?.logs[0].entries).toHaveLength(2);
    // The superseded push's answer: nothing counted as held, so a further change still pushes from the start.
    t.c.onChainAck({ id: first.id!, complete: true });
    t.set([3]);
    t.c.changed();
    expect(t.of("chain")[2].chain?.starts).toHaveLength(1);
    // The latest push held: the same chain isn't pushed again.
    t.c.onChainAck({ id: t.of("chain")[2].id!, complete: true });
    t.c.changed();
    expect(t.of("chain")).toHaveLength(3);
  });

  it("sends pieces one at a time, and sends again only a piece the relay didn't take", async () => {
    // Three epochs, each a piece of its own (300 KB rosters).
    const t = setUp([1, 1, 1], 300_000);
    t.c.start("challenge", "0000000000000001");
    await t.flush();
    const chains = () => t.of("chain");
    const epochsOf = (m: { chain?: ChainData }) => m.chain?.starts.map((s) => (s as { epoch: number }).epoch);
    expect(chains()).toHaveLength(1);
    expect(epochsOf(chains()[0])).toEqual([0]);
    t.c.onChainAck({ id: chains()[0].id!, complete: true });
    expect(chains()).toHaveLength(2);
    expect(epochsOf(chains()[1])).toEqual([1]);
    // Not taken (the relay's queue): that piece again, after a wait, and only it.
    t.c.onChainAck({ id: chains()[1].id!, complete: false });
    t.clock.advance(999);
    expect(chains()).toHaveLength(2);
    t.clock.advance(1);
    expect(chains()).toHaveLength(3);
    expect(epochsOf(chains()[2])).toEqual([1]);
    t.c.onChainAck({ id: chains()[2].id!, complete: true });
    expect(epochsOf(chains()[3])).toEqual([2]);
    // A change meanwhile (a new epoch): what's still to send is replaced at once, from the first epoch not shown held;
    // the earlier piece's answer no longer counts.
    t.set([1, 1, 1, 1]);
    t.c.changed();
    expect(chains()).toHaveLength(5);
    expect(epochsOf(chains()[4])).toEqual([2]);
    t.c.onChainAck({ id: chains()[3].id!, complete: true });
    expect(chains()).toHaveLength(5);
    t.c.onChainAck({ id: chains()[4].id!, complete: true });
    expect(epochsOf(chains()[5])).toEqual([3]);
    t.c.onChainAck({ id: chains()[5].id!, complete: true });
    // Held in full: nothing more.
    t.clock.advance(120_000);
    t.c.changed();
    expect(chains()).toHaveLength(6);
  });

  it("a new socket starts over: the relay holds nothing of this page's", async () => {
    const t = setUp([1]);
    t.c.start("a", "0000000000000001");
    await t.flush();
    t.c.onChainAck({ id: t.of("chain")[0].id!, complete: true });
    t.c.stop();
    t.c.start("b", "0000000000000002");
    await t.flush();
    expect(t.of("prove")).toHaveLength(2);
    expect(t.of("chain")).toHaveLength(2);
  });
});

describe("a chain in pieces a relay message holds", () => {
  it("keeps whole epochs together where they fit, and splits a roster larger than a piece", () => {
    const entry = (i: number) => ({ sig: `${"x".repeat(200)}${i}` });
    const big = Array.from({ length: 6_000 }, (_, i) => entry(i));
    const data = {
      starts: [{ epoch: 0 }, { epoch: 1 }, { epoch: 2 }],
      logs: [
        { scope: "0:a", entries: [entry(1)] },
        { scope: "1:b", entries: big },
        { scope: "2:c", entries: [entry(2)] },
      ],
    };
    const pieces = relayPieces(data as unknown as ChainData);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) expect(JSON.stringify(piece).length).toBeLessThanOrEqual(RELAY_PIECE_BYTES);
    // Every entry once, in order; every piece of epoch 1 carries its start.
    const entries = pieces.flatMap((p) => p.logs.flatMap((l) => l.entries));
    expect(entries).toHaveLength(6_002);
    for (const piece of pieces.filter((p) => p.logs.some((l) => l.scope === "1:b")))
      expect(piece.starts).toContainEqual({ epoch: 1 });
  });
});
