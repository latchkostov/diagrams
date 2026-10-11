import { expect, it, vi } from "vitest";
import { applyChoice, relationMenu, RELATION_CHOICES } from "./relationActions";
import { createEditor, type EditorDeps } from "./useEditor";
import type { ReactFlowInstance } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { ActionContext } from "./actions";

it("reads one snapshot for the bulk menu and updates edges once with one history hint", () => {
  let edges: DiagramFlowEdge[] = Array.from({ length: 2000 }, (_, i) => ({
    id: `e${i}`,
    source: "a",
    target: "b",
    data: { kind: "sync" },
  }));
  const rf = { getNodes: vi.fn(() => []), getEdges: vi.fn(() => edges) } as unknown as ReactFlowInstance<
    FlowNode,
    DiagramFlowEdge
  >;
  const hint = vi.fn();
  const setEdges = vi.fn((update: Parameters<EditorDeps["setEdges"]>[0]) => {
    edges = typeof update === "function" ? update(edges) : update;
  });
  const deps = { meta: { title: "Test" }, history: { hint }, setEdges } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const getDiagram = vi.spyOn(api, "getDiagram");
  const getEdge = vi.spyOn(api, "getEdge");
  const ids = edges.map((e) => e.id);
  const menu = relationMenu({
    target: "selection",
    editor: api,
    selection: { nodeIds: [], groupIds: [], edgeIds: ids },
  } as ActionContext);
  expect(menu.find((m) => m.type === "item" && m.id === "relation:request")).toMatchObject({ checked: true });
  expect(getDiagram).toHaveBeenCalledTimes(1);
  expect(getEdge).not.toHaveBeenCalled();
  getDiagram.mockClear();
  applyChoice(
    api,
    [...ids, "missing"],
    RELATION_CHOICES.find((c) => c.id === "secret")!,
  );
  expect(getDiagram).toHaveBeenCalledTimes(1);
  expect(getEdge).not.toHaveBeenCalled();
  expect(setEdges).toHaveBeenCalledTimes(1);
  expect(hint).toHaveBeenCalledTimes(1);
  expect(edges.every((e) => e.data?.relation === "secret" && e.data.kind === "sync")).toBe(true);
});
