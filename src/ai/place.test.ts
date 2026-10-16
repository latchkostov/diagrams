import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { overlaps } from "../canvas/placement";
import { estimateCardSize } from "../canvas/nodes/size";
import { fitGroupToContents, placeNew } from "./place";
import { boundaryAround } from "../editor/arrange";
import { ancestorGroupIds } from "../model/groupHierarchy";

const node = (id: string, x = 0, y = 0) => ({ id, stencil: "generic.service", label: id, x, y });
const diagram = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Layout",
  nodes: [node("a", 100, 200), node("b", 900, 400), node("c", 500, 900), node("new")],
  edges: [{ id: "e", from: "a", to: "new" }],
});
const boxes = (d: DiagramFile) => d.nodes.map((n) => ({ ...n, ...estimateCardSize(n.label, n.sublabel) }));

describe("placement", () => {
  it("fits child and annotation boxes, preserving empty boundaries", () => {
    const empty = { id: "empty", label: "Empty", group: "outer", x: 900, y: 500, width: 0, height: 0 };
    const child = { id: "inner", label: "Inner", group: "outer", x: 200, y: 100, width: 400, height: 300 };
    const note = {
      id: "note",
      kind: "note" as const,
      text: "Note",
      group: "outer",
      x: 700,
      y: 200,
      width: 100,
      height: 100,
    };
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Nested",
      nodes: [],
      edges: [],
      groups: [{ id: "outer", label: "Outer", x: 0, y: 0, width: 1, height: 1 }, child, empty],
      annotations: [note],
    };
    const fitted = fitGroupToContents(d, "outer");
    expect(fitted.groups![0]).toEqual({ ...d.groups![0], ...boundaryAround([child, empty, note]) });
    expect(fitted.groups![1]).toBe(child);
    expect(fitted.groups![2]).toBe(empty);
    expect(fitGroupToContents(d, "empty")).toBe(d);
  });
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
  it("never lays out the existing nodes in incremental mode, however many are new", () => {
    const d = diagram();
    const result = placeNew(d, ["c", "new"], "incremental");
    expect(result.nodes.slice(0, 2)).toEqual(d.nodes.slice(0, 2));
    expect(result.nodes[3].x).toBeGreaterThan(d.nodes[0].x);
  });
  it.each(["auto", "full"] as const)("joins the only neighbour's boundary unless kept outside, in %s", (mode) => {
    const d = diagram();
    d.nodes[0].group = "g";
    d.groups = [{ id: "g", label: "Cloud", x: 0, y: 0, width: 600, height: 400 }];
    expect(placeNew(d, ["new"], mode).nodes[3].group).toBe("g");
    const kept = placeNew(d, ["new"], mode, [], ["new"]);
    expect(kept.nodes[3].group).toBeUndefined();
    const n = kept.nodes[3];
    expect(overlaps({ ...n, ...estimateCardSize(n.label) }, kept.groups![0])).toBe(false);
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
  it("rechecks earlier cards when a direct member expands an ancestor after descendant fitting", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Mixed membership",
      nodes: [undefined, "inner", "outer", "inner"].map((group, i) => ({
        ...node(`n${i}`),
        label: "Service",
        group,
      })),
      edges: [
        { id: "a", from: "n1", to: "n2" },
        { id: "b", from: "n1", to: "n3" },
        { id: "c", from: "n2", to: "n3" },
      ],
      groups: [
        { id: "outer", label: "Outer", x: 0, y: 0, width: 1, height: 1 },
        { id: "inner", label: "Inner", group: "outer", x: 0, y: 0, width: 1, height: 1 },
      ],
    };
    const result = placeNew(d, [], "full");
    expect(result.nodes.map((n) => n.group)).toEqual(d.nodes.map((n) => n.group));
    for (const box of boxes(result)) {
      for (const group of result.groups!) {
        if (box.group === group.id || (box.group === "inner" && group.id === "outer")) continue;
        expect(overlaps(box, group), `${box.id} overlaps ${group.id}`).toBe(false);
      }
    }
  });
  it.each([false, true])("does no transitive ancestry preparation for metadata/refit edits (refit %s)", (refit) => {
    let reads = 0;
    const count = 1_000;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Deep boundaries",
      nodes: Array.from({ length: count }, (_, i) => ({ ...node(`n${i}`), group: `g${i}` })),
      edges: [],
      groups: Array.from({ length: count }, (_, i) => ({
        id: `g${i}`,
        label: "Boundary",
        get group() {
          reads++;
          return i ? `g${i - 1}` : undefined;
        },
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
    };
    const result = placeNew(d, [], "none", refit ? [`g${count - 1}`] : []);
    expect(result.nodes).toEqual(d.nodes);
    expect(reads).toBeLessThan(count * 20);
    if (!refit) expect(result).toBe(d);
  });
  it("settles interleaved sibling subtrees without repeatedly expanding their boundaries over each other", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Interleaved membership",
      nodes: ["b", "c", "a", "b", undefined, "b", undefined, "c"].map((group, i) => ({
        ...node(`n${i}`),
        label: "Service",
        group,
      })),
      edges: [
        { id: "a", from: "n0", to: "n4" },
        { id: "b", from: "n1", to: "n3" },
      ],
      groups: [
        { id: "a", label: "A", x: 0, y: 0, width: 1, height: 1 },
        { id: "b", label: "B", x: 0, y: 0, width: 1, height: 1 },
        { id: "c", label: "C", group: "a", x: 0, y: 0, width: 1, height: 1 },
      ],
      annotations: [
        { id: "note", kind: "note", text: "Member note", group: "b", x: 0, y: 150, width: 120, height: 80 },
      ],
    };
    const before = structuredClone(d);
    const result = placeNew(d, [], "full");
    expect(d).toEqual(before);
    const note = result.annotations![0];
    const boundary = result.groups!.find((g) => g.id === note.group)!;
    expect(note).not.toMatchObject({ x: 0, y: 150 });
    expect(note.x).toBeGreaterThanOrEqual(boundary.x);
    expect(note.y).toBeGreaterThanOrEqual(boundary.y);
    expect(note.x + note.width).toBeLessThanOrEqual(boundary.x + boundary.width);
    expect(note.y + note.height).toBeLessThanOrEqual(boundary.y + boundary.height);
    for (const box of boxes(result)) {
      const ancestors = box.group ? ancestorGroupIds(box.group, result.groups!) : new Set<string>();
      for (const group of result.groups!) {
        if (box.group === group.id || ancestors.has(group.id)) continue;
        expect(overlaps(box, group), `${box.id} overlaps ${group.id}`).toBe(false);
      }
    }
    for (const group of result.groups!) {
      const ancestors = ancestorGroupIds(group.id, result.groups!);
      for (const other of result.groups!) {
        if (
          group.id === other.id ||
          ancestors.has(other.id) ||
          ancestorGroupIds(other.id, result.groups!).has(group.id)
        )
          continue;
        expect(overlaps(group, other), `${group.id} overlaps ${other.id}`).toBe(false);
      }
    }
    expect(placeNew(d, [], "full")).toEqual(result);
  });
  it("keeps sibling boundary padding disjoint when cards are clear", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Sibling padding",
      nodes: ["a", "b", "a"].map((group, i) => ({ ...node(`n${i}`), label: "Service", group })),
      edges: [],
      groups: ["a", "b"].map((id) => ({ id, label: id, x: 0, y: 0, width: 1, height: 1 })),
    };
    const result = placeNew(d, [], "full");
    for (const box of boxes(result))
      for (const group of result.groups!) if (box.group !== group.id) expect(overlaps(box, group)).toBe(false);
    expect(overlaps(result.groups![0], result.groups![1])).toBe(false);
  });
});
