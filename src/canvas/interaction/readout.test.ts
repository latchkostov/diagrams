import { describe, expect, it } from "vitest";
import { initialReadout, readout, readoutTab } from "./readout";

describe("Live readout ownership", () => {
  const node = { kind: "node" as const, id: "service" };
  const edge = { kind: "edge" as const, id: "call" };
  it("keeps a pinned card when the pointer leaves or reaches another item", () => {
    const pinned = readout(initialReadout(), { type: "pin", target: node });
    expect(readout(pinned, { type: "point", target: null })).toBe(pinned);
    expect(readout(pinned, { type: "point", target: edge })).toBe(pinned);
    expect(readout(pinned, { type: "pin", target: edge }).open).toEqual({ ...edge, pinned: true });
  });
  it("does not reopen a dismissed card just because focus returned to its node", () => {
    const pinned = readout(initialReadout(), { type: "pin", target: node });
    const closed = readout(pinned, { type: "close" });
    expect(readout(closed, { type: "point", target: node }).open).toBeNull();
    expect(readout(readout(closed, { type: "point", target: null }), { type: "point", target: node }).open).toEqual({
      ...node,
      pinned: false,
    });
    expect(readout(closed, { type: "pin", target: node }).open?.pinned).toBe(true);
  });
  it("reuses the snapshot on movements within the same card", () => {
    const shown = readout(initialReadout(), { type: "point", target: node });
    expect(readout(shown, { type: "point", target: node })).toBe(shown);
  });
  it("closes an unpinned readout when neither pointer nor keyboard focus names an item", () => {
    const shown = readout(initialReadout(), { type: "point", target: node });
    expect(readout(shown, { type: "point", target: null }).open).toBeNull();
  });
});

describe("Tab from inside a readout", () => {
  const target = { kind: "node" as const, id: "service" };
  const at = (pinned: boolean, card: boolean, last: boolean) => ({ target, pinned, card, last });
  it.each([
    ["T1 an unpinned card goes on to the next item", at(false, true, true), false, "next"],
    ["T1 from an arrow-focused row too", at(false, false, false), false, "next"],
    ["T1 Shift+Tab returns to its item", at(false, false, false), true, "owner"],
    ["T2 a pinned card enters its first section", at(true, true, false), false, "native"],
    ["T2 Shift+Tab from a pinned card returns to its item", at(true, true, false), true, "owner"],
    ["T3 between sections the browser moves", at(true, false, false), false, "native"],
    ["T3 Shift+Tab between sections too", at(true, false, true), true, "native"],
    ["T4 the last section leaves for the next item", at(true, false, true), false, "next"],
    ["T4 a pinned card without sections is its own last stop", at(true, true, true), false, "next"],
  ] as const)("%s", (_name, stop, back, way) => expect(readoutTab(stop, back)).toBe(way));
  it("keyboard traversal releases a pinned card to an ordinary summary the next item replaces", () => {
    const pinned = readout(initialReadout(), { type: "pin", target });
    const released = readout(pinned, { type: "release" });
    expect(released.open).toEqual({ ...target, pinned: false });
    expect(readout(released, { type: "point", target: { kind: "node", id: "next" } }).open?.id).toBe("next");
    const shown = readout(initialReadout(), { type: "point", target });
    expect(readout(shown, { type: "release" })).toBe(shown);
  });
});
