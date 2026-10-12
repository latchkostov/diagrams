import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { makePayload } from "./clipboard";
import { createEditor, type EditorDeps } from "./useEditor";

// Ctrl+D, Ctrl+V and Alt-drag (D9): a copy never lands on the original or on anything else.

type Box = { x: number; y: number; width: number; height: number };
const SIZE = { width: 180, height: 64 };

/** a (0,0) → b (400,0), c (0,300); nodes 180×64. `pointer` is where the pointer is over the canvas. */
function setup(pointer?: { x: number; y: number }) {
  const flow = toFlow({
    format: "diagrams/v1",
    title: "t",
    nodes: [
      { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "generic.service", label: "B", x: 400, y: 0 },
      { id: "c", stencil: "generic.service", label: "C", x: 0, y: 300 },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
  });
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
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
    pointer: () => pointer,
    edgeMarks: () => [],
    setEditing: vi.fn(),
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) => void (nodes = typeof u === "function" ? u(nodes) : u),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) => void (edges = typeof u === "function" ? u(edges) : u),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const boxOf = (id: string): Box => {
    const n = nodes.find((x) => x.id === id)!;
    return { ...n.position, ...SIZE };
  };
  const overlapsAny = (id: string) =>
    nodes
      .filter((n) => n.id !== id)
      .some((n) => {
        const a = boxOf(id);
        const b = boxOf(n.id);
        return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      });
  return { api, boxOf, overlapsAny, nodes: () => nodes, edges: () => edges };
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

  it("brings the edges between copied nodes along", () => {
    const t = setup();
    t.api.duplicate({ nodeIds: ["a", "b"] });
    expect(t.edges().some((e) => e.source === "a-1" && e.target === "b-1")).toBe(true);
    expect(t.overlapsAny("a-1") || t.overlapsAny("b-1")).toBe(false);
  });
});

describe("Ctrl+V", () => {
  it("centres the paste on the pointer over the canvas when that spot is free", () => {
    const t = setup({ x: 1000, y: 1000 });
    t.api.pastePayload(makePayload(t.api.getDiagram(), ["a"])!);
    const b = t.boxOf("a-1");
    expect(Math.abs(b.x + b.width / 2 - 1000)).toBeLessThanOrEqual(10);
    expect(Math.abs(b.y + b.height / 2 - 1000)).toBeLessThanOrEqual(10);
  });

  it("pointing at a node, or pasting twice, lands clear", () => {
    const t = setup({ x: 90, y: 32 });
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
});

describe("Alt-drag", () => {
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
});
