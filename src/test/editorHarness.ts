import { vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import type { DiagramFile } from "../model/types";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { createEditor, type EditorDeps } from "../editor/useEditor";

/** Synchronous editor port: document writes are inspectable independently of React Flow delivery. */
export function editorHarness(diagram: DiagramFile) {
  const flow = toFlow(diagram);
  let nodes = flow.nodes;
  let edges = flow.edges;
  const setNodes: EditorDeps["setNodes"] = (u) => {
    nodes = typeof u === "function" ? u(nodes) : u;
  };
  const setEdges: EditorDeps["setEdges"] = (u) => {
    edges = typeof u === "function" ? u(edges) : u;
  };
  const rf = {
    getNodes: () => nodes,
    getEdges: () => edges,
    getNode: (id: string) => nodes.find((n) => n.id === id),
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const deps = {
    meta: flow.meta,
    setNodes,
    setEdges,
    history: { hint: vi.fn(), undo: vi.fn() },
    nodeSize: { width: 220, height: 72 },
    prefs: { snap: true },
    fit: vi.fn(),
    reveal: vi.fn(),
    edgeMarks: () => [],
    viewCenter: () => ({ x: 0, y: 0 }),
  } as unknown as EditorDeps;
  const editor = createEditor(rf, deps);
  return {
    ...editor,
    nodes: () => nodes,
    edges: () => edges,
    setNodes,
    commit: () => editor.updateDeps(rf, deps),
    deps,
  };
}
