import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { overlaps } from "../canvas/placement";
import { estimateCardSize } from "../canvas/nodes/size";
import { fitGroupToContents, placeNew } from "./place";

const node = (id: string, x = 0, y = 0) => ({ id, stencil: "generic.service", label: id, x, y });
const diagram = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Layout",
  nodes: [node("a", 100, 200), node("b", 900, 400), node("c", 500, 900), node("new")],
  edges: [{ id: "e", from: "a", to: "new" }],
});
const boxes = (d: DiagramFile) => d.nodes.map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) }));

describe("placement", () => {
  it.each(["LR", "TB"] as const)("places downstream along %s without moving existing nodes", (direction) => {
    const d = diagram();
    d.direction = direction;
    const result = placeNew(d, ["new"]);
    expect(result.nodes.slice(0, 3)).toEqual(d.nodes.slice(0, 3));
    const a = result.nodes[0],
      n = result.nodes[3];
    expect(direction === "LR" ? n.x > a.x : n.y > a.y).toBe(true);
    expect(d.nodes[3]).toEqual(node("new"));
  });
  it("places incoming additions upstream", () => {
    const d = diagram();
    d.edges[0] = { id: "e", from: "new", to: "a" };
    expect(placeNew(d, ["new"]).nodes[3].x).toBeLessThan(d.nodes[0].x);
  });
  it.each(["auto", "full", "none"] as const)("avoids overlap for disconnected additions in %s", (mode) => {
    const d: DiagramFile = { ...diagram(), nodes: Array.from({ length: 12 }, (_, i) => node(`n${i}`)), edges: [] };
    const result = placeNew(
      d,
      d.nodes.map((n) => n.id),
      mode,
    );
    const bs = boxes(result);
    expect(bs.every((b, i) => bs.every((o, j) => i === j || !overlaps(b, o)))).toBe(true);
  });
  it("lays out all nodes when at least half are new, including the exact threshold", () => {
    const d = diagram();
    expect(placeNew(d, ["c", "new"]).nodes[0].x).not.toBe(d.nodes[0].x);
    expect(placeNew(d, ["new"], "full").nodes[0].x).not.toBe(d.nodes[0].x);
    expect(placeNew(d, ["c", "new"], "none").nodes[0]).toEqual(d.nodes[0]);
  });
  it("fits only touched boundaries for incremental layout", () => {
    const d = diagram();
    d.nodes[3].group = "g";
    d.groups = [
      { id: "g", label: "New", x: 0, y: 0, width: 0, height: 0 },
      { id: "untouched", label: "Kept", x: 700, y: 300, width: 1000, height: 800 },
    ];
    const result = placeNew(d, ["new"]);
    expect(result.groups?.[0].width).toBeGreaterThan(220);
    expect(result.groups?.[1]).toEqual(d.groups[1]);
  });
  it("fits contents and leaves an empty boundary alone", () => {
    const d = diagram();
    d.groups = [{ id: "g", label: "Boundary", x: 0, y: 0, width: 400, height: 300 }];
    expect(fitGroupToContents(d, "g")).toBe(d);
    d.nodes[0].group = "g";
    const g = fitGroupToContents(d, "g").groups![0];
    expect(g.x).toBeLessThan(d.nodes[0].x);
    expect(g.y).toBeLessThan(d.nodes[0].y);
  });
});
