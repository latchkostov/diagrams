import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { EdgeMark } from "../canvas/edgeMarks";
import type { DiagramAnnotation, DiagramNode, DiagramGroup } from "../model/types";
import { nestedBoundariesFixture } from "../lab/nestedBoundariesFixture";
import { makePayload } from "./clipboard";
import { createEditor, type EditorDeps } from "./useEditor";

// Ctrl+D, Ctrl+V and Alt-drag (D9): a copy never lands on the original or on anything else, notes,
// shapes and drawn edges included; and its own edges never count against it.

type Box = { x: number; y: number; width: number; height: number };
const SIZE = { width: 180, height: 64 };

interface Setup {
  pointer?: { x: number; y: number };
  nodes?: DiagramNode[];
  annotations?: DiagramAnnotation[];
  groups?: DiagramGroup[];
  /** Edge marks as the canvas would sample them (each knows its edge). */
  marks?: EdgeMark[];
}

/** By default: a (0,0) → b (400,0), c (0,300); nodes 180×64. */
function setup(o: Setup = {}) {
  const flow = toFlow({
    format: "diagrams/v1",
    title: "t",
    nodes: o.nodes ?? [
      { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "generic.service", label: "B", x: 400, y: 0 },
      { id: "c", stencil: "generic.service", label: "C", x: 0, y: 300 },
    ],
    edges: o.nodes ? [] : [{ id: "ab", from: "a", to: "b" }],
    annotations: o.annotations,
    groups: o.groups,
  });
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  let marks = o.marks ?? [];
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const deps = {
    meta: flow.meta,
    history: { hint: vi.fn() },
    nodeSize: SIZE,
    viewCenter: () => ({ x: 90, y: 32 }),
    pointer: () => o.pointer,
    edgeMarks: () => marks,
    setEditing: vi.fn(),
    rename: vi.fn(),
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) => void (nodes = typeof u === "function" ? u(nodes) : u),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) => void (edges = typeof u === "function" ? u(edges) : u),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const boxOf = (id: string): Box => {
    const n = nodes.find((x) => x.id === id)!;
    return { ...n.position, width: n.width ?? SIZE.width, height: n.height ?? SIZE.height };
  };
  const hits = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const overlapsAny = (id: string) => nodes.filter((n) => n.id !== id).some((n) => hits(boxOf(id), boxOf(n.id)));
  const onMark = (id: string) => marks.some((m) => hits(boxOf(id), m));
  return {
    api,
    boxOf,
    overlapsAny,
    onMark,
    hits,
    setMarks: (m: EdgeMark[]) => void (marks = m),
    edges: () => edges,
  };
}

describe("Ctrl+D", () => {
  it("puts the copy beside the original, clear of everything, and selects it", () => {
    const t = setup();
    t.api.duplicate({ nodeIds: ["a"] });
    expect(t.api.getSelection().nodeIds).toEqual(["a-1"]);
    expect(t.overlapsAny("a-1")).toBe(false);
  });

  it("again on the copy keeps stepping, never onto the last copy", () => {
    const t = setup();
    t.api.duplicate({ nodeIds: ["a"] });
    t.api.duplicate({ nodeIds: ["a-1"] });
    t.api.duplicate({ nodeIds: ["a-2"] });
    for (const id of ["a-1", "a-2", "a-3"]) expect(t.overlapsAny(id)).toBe(false);
  });

  it("repeats the gap chosen by moving the copy (smart duplicate)", () => {
    const t = setup();
    t.api.duplicate({ nodeIds: ["c"] });
    // Move the copy to 0, 600 by hand: 300 below c.
    t.api.updateNode("c-1", { x: 0, y: 600 });
    t.api.duplicate({ nodeIds: ["c-1"] });
    expect(t.boxOf("c-2")).toMatchObject({ x: 0, y: 900 });
  });

  it("keeps that history per editor: another diagram's same ids don't inherit it", () => {
    const first = setup();
    first.api.duplicate({ nodeIds: ["a"] });
    // Another diagram that happens to have an "a-1", far away.
    const other = setup({ nodes: [{ id: "a-1", stencil: "generic.service", label: "A", x: 1000, y: 1000 }] });
    other.api.duplicate({ nodeIds: ["a-1"] });
    // One gap to the right of it, not the first diagram's step.
    expect(other.boxOf("a-2")).toMatchObject({ x: 1220, y: 1000 });
  });

  it("brings the edges between copied nodes along", () => {
    const t = setup();
    t.api.duplicate({ nodeIds: ["a", "b"] });
    expect(t.edges().some((e) => e.source === "a-1" && e.target === "b-1")).toBe(true);
    expect(t.overlapsAny("a-1") || t.overlapsAny("b-1")).toBe(false);
  });
});

describe("Ctrl+V", () => {
  it("centres the paste on the pointer over the canvas when that spot is free", () => {
    const t = setup({ pointer: { x: 1000, y: 1000 } });
    t.api.pastePayload(makePayload(t.api.getDiagram(), ["a"])!);
    const b = t.boxOf("a-1");
    expect(Math.abs(b.x + b.width / 2 - 1000)).toBeLessThanOrEqual(10);
    expect(Math.abs(b.y + b.height / 2 - 1000)).toBeLessThanOrEqual(10);
  });

  it("pointing at a node, or pasting twice, lands clear", () => {
    const t = setup({ pointer: { x: 90, y: 32 } });
    const p = makePayload(t.api.getDiagram(), ["a"])!;
    t.api.pastePayload(p);
    t.api.pastePayload(p);
    expect(t.overlapsAny("a-1")).toBe(false);
    expect(t.overlapsAny("a-2")).toBe(false);
  });

  it("with the pointer elsewhere, goes to the free place nearest the view's centre", () => {
    const t = setup(undefined);
    t.api.pastePayload(makePayload(t.api.getDiagram(), ["a"])!);
    expect(t.overlapsAny("a-1")).toBe(false);
  });

  it("refuses geometry that isn't finite instead of moving anything to Infinity", () => {
    const t = setup({ pointer: { x: 1000, y: 1000 } });
    const p = makePayload(t.api.getDiagram(), ["a"])!;
    p.groups.push({ id: "g", label: "G", x: 0, y: 0, width: Infinity, height: 10 });
    t.api.pastePayload(p);
    expect(t.api.getDiagram().nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

/** The four ways a spot can be taken, at the spot the copy would choose first. */
const OBSTACLES: [string, (at: Box) => Setup][] = [
  ["a note", (at) => ({ annotations: [{ id: "n", kind: "note", text: "N", ...at }] })],
  ["a shape", (at) => ({ annotations: [{ id: "s", kind: "shape", shape: "rect", text: "", ...at }] })],
  [
    "a drawn edge",
    (at) => ({
      marks: [0, 40, 80, 120, 160].map((dx) => ({ x: at.x + dx, y: at.y + 30, width: 4, height: 4, edge: "other" })),
    }),
  ],
];

describe.each(OBSTACLES)("copy placement avoids %s", (_name, obstacle) => {
  // Where a lone node's Ctrl+D copy (one gap right) or a paste at (1000, 1000) would land first.
  const RIGHT = { x: 220, y: 0, width: 180, height: 64 };
  const AT_POINTER = { x: 910, y: 968, width: 180, height: 64 };
  const lone = (o: Setup): Setup => ({
    ...o,
    nodes: [{ id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 }],
  });
  // Notes and shapes are nodes here (overlapsAny); edges are their sampled marks.
  const clearOf = (t: ReturnType<typeof setup>, id: string) => !t.overlapsAny(id) && !t.onMark(id);

  it("Ctrl+D", () => {
    const t = setup(lone(obstacle(RIGHT)));
    t.api.duplicate({ nodeIds: ["a"] });
    expect(clearOf(t, "a-1")).toBe(true);
    expect(t.boxOf("a")).toMatchObject({ x: 0, y: 0 });
  });

  it("Ctrl+V", () => {
    const t = setup({ ...lone(obstacle(AT_POINTER)), pointer: { x: 1000, y: 1000 } });
    t.api.pastePayload(makePayload(t.api.getDiagram(), ["a"])!);
    expect(clearOf(t, "a-1")).toBe(true);
  });

  it("an Alt-drag dropped on it", () => {
    const t = setup(lone(obstacle(AT_POINTER)));
    t.api.duplicateInPlace({ nodeIds: ["a"] });
    t.api.updateNode("a-1", { x: AT_POINTER.x, y: AT_POINTER.y });
    t.api.keepClear({ nodeIds: ["a-1"] });
    expect(clearOf(t, "a-1")).toBe(true);
    expect(t.boxOf("a")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("Alt-drag", () => {
  it("remaps a boundary subtree in place without changing the originals", () => {
    const t = setup(nestedBoundariesFixture);
    const original = t.api.getDiagram();
    const made = t.api.duplicateInPlace({ groupIds: ["grp-core", "child"] });
    expect([...made]).toEqual([
      ["member", "member-1"],
      ["note", "note-1"],
      ["group:child", "group:child-1"],
      ["group:grp-core", "group:grp-core-1"],
    ]);
    const copied = t.api.getDiagram();
    for (const key of ["groups", "nodes", "annotations"] as const) {
      const before = original[key] ?? [];
      const after = copied[key] ?? [];
      expect(after).toHaveLength(before.length * 2);
      for (const item of before) {
        expect(after.find((n) => n.id === item.id)).toEqual(item);
        expect(after.find((n) => n.id === `${item.id}-1`)).toEqual({
          ...item,
          id: `${item.id}-1`,
          ...(item.group ? { group: `${item.group}-1` } : {}),
        });
      }
    }
  });

  it("copies in place (old id → new), then a copy left on something moves clear", () => {
    const t = setup();
    const made = t.api.duplicateInPlace({ nodeIds: ["a"] });
    expect(made.get("a")).toBe("a-1");
    expect(t.boxOf("a-1")).toEqual(t.boxOf("a"));
    t.api.keepClear({ nodeIds: ["a-1"] });
    expect(t.overlapsAny("a-1")).toBe(false);
    // The original never moved.
    expect(t.boxOf("a")).toMatchObject({ x: 0, y: 0 });
  });

  it("a connected pair dropped in free space stays put: its own edge isn't in its way", () => {
    const t = setup();
    const made = t.api.duplicateInPlace({ nodeIds: ["a", "b"] });
    const [a1, b1] = [made.get("a")!, made.get("b")!];
    t.api.updateNode(a1, { x: 0, y: 1000 });
    t.api.updateNode(b1, { x: 400, y: 1000 });
    const own = t.edges().find((e) => e.source === a1 && e.target === b1)!;
    // The copies' edge runs between them, through their bounding box.
    t.setMarks([200, 260, 320].map((x) => ({ x, y: 1030, width: 4, height: 4, edge: own.id })));
    t.api.keepClear({ nodeIds: [a1, b1] });
    expect(t.boxOf(a1)).toMatchObject({ x: 0, y: 1000 });
    expect(t.boxOf(b1)).toMatchObject({ x: 400, y: 1000 });
    // Someone else's edge in the same place does count.
    t.setMarks([{ x: 260, y: 1030, width: 4, height: 4, edge: "ab" }]);
    t.api.keepClear({ nodeIds: [a1, b1] });
    expect(t.boxOf(a1)).not.toMatchObject({ x: 0, y: 1000 });
  });
});
