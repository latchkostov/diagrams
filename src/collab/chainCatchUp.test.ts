import { describe, expect, it } from "vitest";
import { CATCH_UP_MS, ChainCatchUp, MAX_CATCH_UP_SENDERS } from "./chainCatchUp";
import { MAX_EPOCHS } from "./epochs";

const tip = (epoch: number) => `${epoch}:${"A".repeat(86)}`;

describe("a page catching up on the room's chain", () => {
  it("keeps the highest tip each sender promised: a later, shorter or empty one never lowers or clears it", () => {
    const c = new ChainCatchUp();
    c.settle(0, 0);
    c.note("a", tip(2), 0);
    c.note("a", tip(1), 1);
    c.note("a", undefined, 2);
    c.note("b", tip(0), 3);
    c.note("b", "garbage", 4);
    expect(c.pending(5)).toBe(true);
    c.settle(1, 6);
    expect(c.pending(6)).toBe(true);
    c.settle(2, 7);
    expect(c.pending(7)).toBe(false);
  });

  it("raises a sender's tip, and goes once the validated chain reaches the highest", () => {
    const c = new ChainCatchUp();
    c.note("a", tip(1), 0);
    c.note("a", tip(3), 1);
    c.settle(1, 2);
    expect(c.pending(2)).toBe(true);
    c.settle(3, 3);
    expect(c.pending(3)).toBe(false);
  });

  it("ignores a tip that can't be an epoch, or one the chain already reaches", () => {
    const c = new ChainCatchUp();
    c.settle(4, 0);
    c.note("a", tip(MAX_EPOCHS), 0);
    c.note("a", tip(MAX_EPOCHS + 40), 0);
    c.note("b", tip(-1), 0);
    c.note("c", tip(3), 0);
    c.note("d", "7", 0);
    expect(c.size).toBe(0);
    expect(c.pending(0)).toBe(false);
  });

  it("is bounded: a few senders, the oldest going first", () => {
    const c = new ChainCatchUp();
    for (let i = 0; i < MAX_CATCH_UP_SENDERS + 5; i++) c.note(`s${i}`, tip(5), i);
    expect(c.size).toBe(MAX_CATCH_UP_SENDERS);
  });

  it("a tip nobody delivers stalls decisions until its deadline, and the chain growing restarts the wait", () => {
    const c = new ChainCatchUp();
    c.settle(0, 0);
    c.note("liar", tip(20), 0);
    expect(c.pending(CATCH_UP_MS - 1)).toBe(true);
    expect(c.pending(CATCH_UP_MS)).toBe(false);
    // An honest catch-up that keeps making progress keeps its wait.
    const h = new ChainCatchUp();
    h.settle(0, 0);
    h.note("member", tip(10), 0);
    h.settle(3, CATCH_UP_MS - 1);
    expect(h.pending(2 * CATCH_UP_MS - 2)).toBe(true);
    expect(h.pending(2 * CATCH_UP_MS - 1)).toBe(false);
  });

  it("raising a promised tip without progress does not renew its deadline", () => {
    const c = new ChainCatchUp();
    c.note("a", tip(1), 0);
    c.note("a", tip(2), CATCH_UP_MS - 1);
    expect(c.pending(CATCH_UP_MS - 1)).toBe(true);
    expect(c.pending(CATCH_UP_MS)).toBe(false);
  });

  it("senders taking turns promising far tips can't renew the wait: one deadline since the chain last grew", () => {
    const c = new ChainCatchUp();
    c.settle(0, 0);
    for (let t = 0; t < 5 * CATCH_UP_MS; t += 10_000) {
      c.note(t % 20_000 ? "b" : "a", tip(20 + ((t / 10_000) % 5)), t);
      expect(c.pending(t)).toBe(t < CATCH_UP_MS);
    }
    // Real progress starts a fresh wait for what's still promised.
    c.note("a", tip(30), 5 * CATCH_UP_MS);
    c.settle(1, 5 * CATCH_UP_MS);
    expect(c.pending(5 * CATCH_UP_MS + 1)).toBe(true);
    expect(c.pending(6 * CATCH_UP_MS)).toBe(false);
  });
});
