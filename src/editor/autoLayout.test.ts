import { expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { boundaryAround } from "./arrange";
import { createEditor, type EditorDeps } from "./useEditor";
import { measuredHierarchyFixture } from "../lab/nestedBoundariesFixture";

it("Auto-layout waits for measured cards before refitting boundaries and requests its fit after the edit", () => {
  const flow = toFlow({
    format: "diagrams/v1",
    title: "Measured layout",
    nodes: [
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 0, group: "cloud" },
      { id: "b", stencil: "service.node", label: "B", x: 300, y: 0, group: "cloud" },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
    groups: [{ id: "cloud", label: "Cloud", x: 0, y: 0, width: 600, height: 200 }],
  });
  let nodes = flow.nodes;
  let ready!: () => void;
  const fit = vi.fn();
  const setNodes: EditorDeps["setNodes"] = (u) => {
    nodes = typeof u === "function" ? u(nodes) : u;
  };
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => flow.edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const { api } = createEditor(rf, {
    meta: flow.meta,
    setNodes,
    nodeSize: { width: 220, height: 72 },
    history: { hint: vi.fn() },
    fit,
    afterMeasured: (run: () => void) => {
      ready = run;
    },
  } as unknown as EditorDeps);
  api.autoLayout();
  expect(nodes).toBe(flow.nodes);
  expect(fit).not.toHaveBeenCalled();
  nodes = nodes.map((n) => (n.type === "diagram" ? { ...n, measured: { width: 260, height: 72 } } : n));
  ready();
  const want = boundaryAround(
    nodes
      .filter((n) => n.type === "diagram")
      .map((n) => ({ id: n.id, ...n.position, width: n.measured!.width!, height: n.measured!.height! })),
  );
  const group = nodes.find((n) => n.type === "boundary")!;
  expect({ ...group.position, width: group.width, height: group.height }).toEqual(want);
  expect(fit).toHaveBeenCalledOnce();
});

it.each([false, true])("refits nested boundaries bottom-up, independent of file order (reverse: %s)", (reverse) => {
  const file = structuredClone(measuredHierarchyFixture);
  if (reverse) file.groups!.reverse();
  const flow = toFlow(file);
  let nodes: FlowNode[] = flow.nodes.map((n) => ({
    ...n,
    measured: n.type === "diagram" ? { width: 260, height: 92 } : { width: n.width, height: n.height },
  }));
  // An annotation's delivered size can differ from its saved box too.
  nodes = nodes.map((n) => (n.id === "note" ? { ...n, measured: { width: 240, height: 140 } } : n));
  const waiting: (() => void)[] = [];
  const fit = vi.fn();
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => flow.edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const { api } = createEditor(rf, {
    meta: flow.meta,
    setNodes: (update: Parameters<EditorDeps["setNodes"]>[0]) => {
      nodes = typeof update === "function" ? update(nodes) : update;
    },
    nodeSize: { width: 220, height: 72 },
    history: { hint: vi.fn() },
    fit,
    afterMeasured: (run: () => void) => {
      waiting.push(run);
    },
  } as unknown as EditorDeps);
  const original = nodes;
  api.autoLayout();
  expect(nodes).toBe(original);
  expect(fit).not.toHaveBeenCalled();
  waiting.shift()!();
  for (const id of ["inner", "middle", "outer"]) {
    const boundary = nodes.find((n) => n.type === "boundary" && n.data.groupId === id)!;
    const members = nodes
      .filter((n) => n.data.group === id)
      .map((n) => ({
        id: n.id,
        ...n.position,
        width: n.type === "boundary" ? n.width! : n.measured!.width!,
        height: n.type === "boundary" ? n.height! : n.measured!.height!,
      }));
    expect({ ...boundary.position, width: boundary.width, height: boundary.height }).toEqual(boundaryAround(members));
  }
  expect(nodes.map((n) => [n.id, n.data.group])).toEqual(original.map((n) => [n.id, n.data.group]));
  expect(nodes.find((n) => n.id === "group:empty")).toBe(original.find((n) => n.id === "group:empty"));
  expect(fit).toHaveBeenCalledOnce();
});
