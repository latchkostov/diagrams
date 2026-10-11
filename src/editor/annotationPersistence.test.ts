import { expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { LIMITS, validateDiagram } from "../interop/native";
import { createEditor, type EditorDeps } from "./useEditor";

it("bounds EditorApi text, geometry and text-size growth so connected annotations reopen", () => {
  const flow = toFlow({
    format: "diagrams/v1",
    title: "t",
    nodes: [{ id: "a", stencil: "service.go", label: "A", x: 0, y: 0 }],
    edges: [{ id: "edge", from: "a", to: "shape" }],
    annotations: [
      { id: "shape", kind: "shape", text: "", x: 0, y: 0, width: 100, height: 100 },
      { id: "text", kind: "text", text: "Title", x: 0, y: 0, width: 19000, height: 19000, textSize: "s" },
    ],
  });
  let nodes = flow.nodes;
  const rf = { getNodes: () => nodes, getEdges: () => flow.edges } as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const deps = {
    meta: flow.meta,
    history: { hint: vi.fn() },
    setNodes: (update: Parameters<EditorDeps["setNodes"]>[0]) => {
      nodes = typeof update === "function" ? update(nodes) : update;
    },
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  api.updateAnnotation("shape", {
    width: Infinity,
    height: LIMITS.maxAnnotationSize + 10,
    text: "x".repeat(LIMITS.maxAnnotationText + 10),
    x: LIMITS.maxCoordinate * 2,
  });
  api.updateAnnotation("text", { textSize: "xl" });
  expect(api.getAnnotation("shape")).toMatchObject({
    width: 1,
    height: LIMITS.maxAnnotationSize,
    x: LIMITS.maxCoordinate,
  });
  expect(api.getAnnotation("shape")?.text).toHaveLength(LIMITS.maxAnnotationText);
  expect(api.getAnnotation("text")).toMatchObject({
    width: LIMITS.maxAnnotationSize,
    height: LIMITS.maxAnnotationSize,
  });
  const r = validateDiagram(api.getDiagram());
  if (!r.ok) throw new Error(r.error);
  expect(r.warnings).toEqual([]);
  expect(r.diagram.annotations).toHaveLength(2);
  expect(r.diagram.edges).toHaveLength(1);
});
