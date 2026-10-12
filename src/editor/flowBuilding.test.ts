import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { EdgeMark } from "../canvas/edgeMarks";
import { createEditor, type EditorDeps } from "./useEditor";

// Flow building (batch 3): the next node one gap beside a node, connected the right way (D3), the selection-
// aware rail and Ctrl+K (D13, decision 4), and rewiring edges through the editor (D8).

type Box = { x: number; y: number; width: number; height: number };
const SIZE = { width: 220, height: 72 };

/** hub alone at (1000, 400); a → b in a row far to the left, with a labelled request edge. */
function setup(marks: EdgeMark[] = []) {
  const flow = toFlow({
    format: "diagrams/v1",
    title: "t",
    nodes: [
      { id: "hub", stencil: "kafka.topic", label: "Hub", x: 1000, y: 400 },
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "postgres", label: "B", x: 500, y: 0 },
    ],
    edges: [{ id: "ab", from: "a", to: "b", kind: "sync", label: "writes", props: { dlq: true } }],
  });
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const reveal = vi.fn();
  const deps = {
    meta: flow.meta,
    history: { hint: vi.fn() },
    nodeSize: SIZE,
    viewCenter: () => ({ x: 1110, y: 1000 }),
    edgeMarks: () => marks,
    setEditing: vi.fn(),
    reveal,
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) => void (nodes = typeof u === "function" ? u(nodes) : u),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) => void (edges = typeof u === "function" ? u(edges) : u),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const boxOf = (id: string): Box => {
    const n = nodes.find((x) => x.id === id);
    if (!n) throw new Error(`no node ${id}`);
    return { ...n.position, width: n.width ?? SIZE.width, height: n.height ?? SIZE.height };
  };
  const hits = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const overlapsAny = (id: string) => nodes.filter((n) => n.id !== id).some((n) => hits(boxOf(id), boxOf(n.id)));
  return { api, boxOf, overlapsAny, edges: () => edges, nodes: () => nodes, reveal };
}

describe("the next node (Alt+arrow, the +)", () => {
  it("lands one gap that way, connected from the node for → and ↓, into it for ← and ↑", () => {
    const hub = { x: 1000, y: 400, width: 220, height: 72 };
    const cases = [
      ["right", (b: Box) => b.x >= hub.x + hub.width && b.y === hub.y, true],
      ["down", (b: Box) => b.y >= hub.y + hub.height && b.x === hub.x, true],
      ["left", (b: Box) => b.x + b.width <= hub.x && b.y === hub.y, false],
      ["up", (b: Box) => b.y + b.height <= hub.y && b.x === hub.x, false],
    ] as const;
    for (const [toward, where, downstream] of cases) {
      const t = setup();
      const made = t.api.addConnected("hub", "redis.cache", toward);
      if (!made) throw new Error("nothing added");
      expect(where(t.boxOf(made.id)), toward).toBe(true);
      const e = t.edges().find((x) => x.id === made.edge);
      expect([e?.source, e?.target]).toEqual(downstream ? ["hub", made.id] : [made.id, "hub"]);
      // Selected (and only it), clear of everything.
      expect(t.api.getSelection().nodeIds).toEqual([made.id]);
      expect(t.overlapsAny(made.id)).toBe(false);
    }
  });

  it("leaves room for a named edge along the flow: a 160 px gap", () => {
    const t = setup();
    const made = t.api.addConnected("hub", "redis.cache", "right");
    expect(t.boxOf(made?.id ?? "").x).toBe(1000 + 220 + 160);
  });

  it("defaults to downstream, and a fan-out steps into a column clear of its siblings", () => {
    const t = setup();
    const ids = [1, 2, 3].map(() => t.api.addConnected("hub", "service.java")?.id ?? "");
    const xs = new Set(ids.map((id) => t.boxOf(id).x));
    expect(xs.size).toBe(1);
    for (const id of ids) expect(t.overlapsAny(id)).toBe(false);
    expect(t.edges().filter((e) => e.source === "hub")).toHaveLength(3);
  });

  it("never lands on a drawn edge", () => {
    // An edge passing right where the next node would go.
    const marks: EdgeMark[] = [];
    for (let y = 300; y <= 600; y += 24) marks.push({ x: 1478, y, width: 4, height: 4, edge: "x" });
    const t = setup(marks);
    const spot = t.api.nextSpot("hub", "right");
    if (!spot) throw new Error("no spot");
    expect(
      marks.some(
        (m) =>
          m.x < spot.x + spot.width && spot.x < m.x + m.width && m.y < spot.y + spot.height && spot.y < m.y + m.height,
      ),
    ).toBe(false);
  });

  it("Alt+Shift+arrow copies the node there (stencil, label), connected the same way", () => {
    const t = setup();
    const made = t.api.cloneConnected("hub", "down");
    if (!made) throw new Error("no copy");
    const copy = t.nodes().find((n) => n.id === made.id);
    expect(copy?.data).toMatchObject({ stencil: "kafka.topic", label: "Hub" });
    expect(t.boxOf(made.id).y).toBeGreaterThanOrEqual(400 + 72);
    expect(t.edges().find((e) => e.id === made.edge)).toMatchObject({ source: "hub", target: made.id });
    expect(t.overlapsAny(made.id)).toBe(false);
  });
});

describe("relationships", () => {
  it("a next node that's a typed dependency (Key Vault) is inferred as one, as any connect is", () => {
    const t = setup();
    const made = t.api.addConnected("a", "azure.key-vault", "down");
    expect(t.edges().find((e) => e.id === made?.edge)?.data?.relation).toBe("secret");
  });
});

describe("the rail and Ctrl+K (decision 4)", () => {
  it("with exactly one node selected, a stencil goes after it, connected, in view", () => {
    const t = setup();
    t.api.select({ nodeIds: ["hub"] });
    expect(t.api.stencilAnchor()).toBe("hub");
    const id = t.api.addStencil("redis.cache");
    expect(t.edges().find((e) => e.target === id)?.source).toBe("hub");
    expect(t.reveal).toHaveBeenCalled();
  });

  it("with nothing or several selected, it's unconnected, in free space", () => {
    for (const sel of [{}, { nodeIds: ["hub", "a"] }, { nodeIds: ["hub"], edgeIds: ["ab"] }]) {
      const t = setup();
      t.api.select(sel);
      expect(t.api.stencilAnchor()).toBeUndefined();
      const id = t.api.addStencil("redis.cache");
      expect(t.edges()).toHaveLength(1);
      expect(t.overlapsAny(id)).toBe(false);
    }
  });
});

describe("rewiring edges (D8)", () => {
  it("insertIntoEdge splits the edge around the node, keeping its meaning", () => {
    const t = setup();
    expect(t.api.insertIntoEdge("ab", "hub")).toBe(true);
    expect(t.edges().map((e) => [e.id, e.source, e.target, e.data?.label, e.data?.kind])).toEqual([
      ["ab", "a", "hub", "writes", "sync"],
      ["e-1", "hub", "b", undefined, "sync"],
    ]);
    expect(t.api.insertIntoEdge("ab", "a")).toBe(false);
  });

  it("reconnectEdge moves one end, never onto the other end", () => {
    const t = setup();
    expect(t.api.reconnectEdge("ab", "target", "hub")).toBe(true);
    expect(t.edges()[0]).toMatchObject({ id: "ab", source: "a", target: "hub", data: { label: "writes" } });
    expect(t.api.reconnectEdge("ab", "source", "hub")).toBe(false);
  });
});
