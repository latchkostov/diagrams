import { describe, expect, it } from "vitest";
import { TRACE_CARD_FOOTPRINT, TRACE_CARD_TOP, roomUnderCard } from "./traceCardLayout";

const node = (x: number, y: number, type = "diagram", data?: unknown) => ({
  type,
  data,
  measured: { width: 200, height: 60 },
  internals: { positionAbsolute: { x, y } },
});
const state = (nodes: ReturnType<typeof node>[]) => ({
  width: 1200,
  transform: [0, 0, 1] as const,
  nodeLookup: new Map(nodes.map((n, i) => [String(i), n])),
});

describe("trace card room", () => {
  it("grows down to the first node card under its column", () => {
    expect(roomUnderCard(state([node(900, 500), node(900, 700)]), 352)).toBe(500 - 12 - TRACE_CARD_TOP);
  });

  it("ignores nodes beside its column, boundaries and zones", () => {
    const nodes = [node(100, 400), node(800, 300, "boundary"), node(900, 350, "annotation", { kind: "zone" })];
    expect(roomUnderCard(state(nodes), 352)).toBe(0);
  });

  it("never shrinks below its footprint", () => {
    expect(roomUnderCard(state([node(900, 290)]), 352)).toBe(TRACE_CARD_FOOTPRINT);
  });
});
