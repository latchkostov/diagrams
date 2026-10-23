import { describe, expect, it } from "vitest";
import { initialReadout, readout } from "./readout";

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
