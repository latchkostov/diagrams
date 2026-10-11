import { describe, expect, it, vi } from "vitest";
import { LAYOUT_GRID, layeredLayout } from "./layout";

const n = (id: string, x = 0, y = 0) => ({ id, x, y });

describe("layeredLayout", () => {
  it("keeps index updates linear for a many-layer chain", () => {
    const count = 100;
    const nodes = Array.from({ length: count }, (_, i) => n(`n${i}`));
    const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id }));
    const set = vi.spyOn(Map.prototype, "set");
    try {
      const positions = layeredLayout({ nodes, edges });
      expect(positions.get(`n${count - 1}`)?.x).toBe(40 + (count - 1) * LAYOUT_GRID.LR.along);
      expect(set.mock.calls.length).toBeLessThan(count * 30);
    } finally {
      set.mockRestore();
    }
  });
  it("puts each hop in the next column", () => {
    const p = layeredLayout({
      nodes: [n("a"), n("b"), n("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect([p.get("a")!.x, p.get("b")!.x, p.get("c")!.x]).toEqual([
      40,
      40 + LAYOUT_GRID.LR.along,
      40 + 2 * LAYOUT_GRID.LR.along,
    ]);
  });

  it("ignores back-edges so cycles don't stretch the layout", () => {
    const p = layeredLayout({
      nodes: [n("a"), n("b"), n("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    expect(p.get("a")!.x).toBe(40);
    expect(p.get("c")!.x).toBe(40 + 2 * LAYOUT_GRID.LR.along);
  });

  it("stacks siblings in a layer and lays out TB vertically", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
    ];
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

  it("widens columns for wide nodes and long edge labels, never overlapping", () => {
    const wide = { ...n("a"), width: 300, height: 72 };
    const p = layeredLayout({
      nodes: [wide, n("b"), n("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c", label: "Upsert the latest device reading" },
      ],
    });
    expect(p.get("b")!.x - p.get("a")!.x).toBeGreaterThanOrEqual(300 + 140);
    const gap = p.get("c")!.x - (p.get("b")!.x + 220);
    expect(gap).toBeGreaterThan(140); // room for the wrapped label
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...n(`k${i}`),
      label: "Notification service",
      sublabel: "group: customer-notifications",
      height: 90,
    }));
    const q = layeredLayout({ nodes: [n("root"), ...many], edges: many.map((m) => ({ from: "root", to: m.id })) });
    const ys = many.map((m) => q.get(m.id)!.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(90 + 24);
  });
});
