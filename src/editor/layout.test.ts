import { describe, expect, it } from "vitest";
import { LAYOUT_GRID, layeredLayout } from "./layout";

const n = (id: string, x = 0, y = 0) => ({ id, x, y });

describe("layeredLayout", () => {
  it("puts each hop in the next column", () => {
    const p = layeredLayout({ nodes: [n("a"), n("b"), n("c")], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] });
    expect([p.get("a")!.x, p.get("b")!.x, p.get("c")!.x]).toEqual([40, 40 + LAYOUT_GRID.LR.along, 40 + 2 * LAYOUT_GRID.LR.along]);
  });

  it("ignores back-edges so cycles don't stretch the layout", () => {
    const p = layeredLayout({
      nodes: [n("a"), n("b"), n("c")],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
    });
    expect(p.get("a")!.x).toBe(40);
    expect(p.get("c")!.x).toBe(40 + 2 * LAYOUT_GRID.LR.along);
  });

  it("stacks siblings in a layer and lays out TB vertically", () => {
    const edges = [{ from: "a", to: "b" }, { from: "a", to: "c" }];
    const lr = layeredLayout({ nodes: [n("a"), n("b", 0, 0), n("c", 0, 100)], edges });
    expect(lr.get("b")!.x).toBe(lr.get("c")!.x);
    expect(lr.get("c")!.y - lr.get("b")!.y).toBe(LAYOUT_GRID.LR.across);
    const tb = layeredLayout({ nodes: [n("a"), n("b"), n("c", 100)], edges, direction: "TB" });
    expect(tb.get("b")!.y).toBe(40 + LAYOUT_GRID.TB.along);
    expect(tb.get("b")!.y).toBe(tb.get("c")!.y);
  });

  it("handles disconnected nodes and self-loops", () => {
    const p = layeredLayout({ nodes: [n("a"), n("b")], edges: [{ from: "a", to: "a" }] });
    expect(p.size).toBe(2);
  });
});
