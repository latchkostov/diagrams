import { expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { boundaryAround } from "./arrange";
import { createEditor, type EditorDeps } from "./useEditor";

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
