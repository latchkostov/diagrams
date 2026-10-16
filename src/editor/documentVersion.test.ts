import { expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { createEditor, type EditorDeps } from "./useEditor";
import { snapshotKey } from "./historySelection";

it("versions every document edit, including external replacements and undo, with constant-time reads", () => {
  let flow = toFlow({
    format: "diagrams/v1",
    title: "Versioned",
    nodes: [
      { id: "a", stencil: "service.go", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.go", label: "B", x: 300, y: 0 },
      { id: "c", stencil: "service.go", label: "C", x: 600, y: 0 },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
  });
  const rf = { getNodes: vi.fn(() => flow.nodes), getEdges: vi.fn(() => flow.edges) } as unknown as ReactFlowInstance<
    FlowNode,
    DiagramFlowEdge
  >;
  const deps = (): EditorDeps =>
    ({
      slug: "versioned",
      documentId: "document",
      documentKey: snapshotKey(flow),
      meta: flow.meta,
      setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) => {
        flow = { ...flow, nodes: typeof u === "function" ? u(flow.nodes) : u };
      },
      setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) => {
        flow = { ...flow, edges: typeof u === "function" ? u(flow.edges) : u };
      },
      setMeta: (u: Parameters<EditorDeps["setMeta"]>[0]) => {
        flow = { ...flow, meta: typeof u === "function" ? u(flow.meta) : u };
      },
      history: { hint: vi.fn() },
      nodeSize: { width: 220, height: 72 },
    }) as unknown as EditorDeps;
  const editor = createEditor(rf, deps());
  const api = editor.api;
  const initial = api.getDocumentVersion();
  api.select({ nodeIds: ["a"] });
  editor.updateDeps(rf, deps());
  expect(api.getDocumentVersion()).toBe(initial);
  for (const edit of [
    () => api.updateNode("a", { label: "Renamed" }),
    () => api.updateNode("a", { x: 1000 }),
    () => api.reconnectEdge("ab", "target", "c"),
    () => api.updateMeta({ title: "New title" }),
  ]) {
    const before = api.getDocumentVersion();
    edit();
    // Visible even before React commits; reverting before a slice is still a newer revision.
    expect(api.getDocumentVersion().revision).toBeGreaterThan(before.revision);
    editor.updateDeps(rf, deps());
    expect(api.getDocumentVersion().identity).toBe(initial.identity);
  }
  const changed = api.getDocumentVersion();
  flow = { ...flow, meta: { ...flow.meta, title: "Versioned" } };
  editor.updateDeps(rf, deps());
  expect(api.getDocumentVersion().revision).toBeGreaterThan(changed.revision);
  const reads = vi.mocked(rf.getNodes).mock.calls.length + vi.mocked(rf.getEdges).mock.calls.length;
  const stable = api.getDocumentVersion();
  for (let n = 0; n < 1000; n++) expect(api.getDocumentVersion()).toBe(stable);
  expect(vi.mocked(rf.getNodes).mock.calls.length + vi.mocked(rf.getEdges).mock.calls.length).toBe(reads);
  editor.updateDeps(rf, { ...deps(), documentId: "replacement" });
  expect(api.getDocumentVersion().identity).not.toBe(initial.identity);
  expect(api.getDocumentVersion().revision).toBeGreaterThan(stable.revision);
});
