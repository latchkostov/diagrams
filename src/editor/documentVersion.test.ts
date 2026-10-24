import { expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { createEditor, type EditorDeps } from "./useEditor";
import { LiveController } from "../live/controller";
import { breakerFixture } from "../lab/resilienceFixture";
import { effectiveCallerPolicy } from "./callerPolicy";
import { roomSnapshotKey, snapshotKey } from "./historySelection";

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

it("versions remote room projections and reversions without counting selection or measurements", () => {
  let flow = toFlow({
    format: "diagrams/v1",
    title: "Room",
    nodes: [{ id: "api", stencil: "service.go", label: "API", x: 0, y: 0 }],
    edges: [],
  });
  const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as unknown as ReactFlowInstance<
    FlowNode,
    DiagramFlowEdge
  >;
  const deps = () => ({ slug: "room", documentKey: roomSnapshotKey(flow) }) as unknown as EditorDeps;
  const editor = createEditor(rf, deps());
  const initial = editor.api.getDocumentVersion();
  flow = { ...flow, nodes: flow.nodes.map((n) => ({ ...n, selected: true, measured: { width: 220, height: 72 } })) };
  editor.updateDeps(rf, deps());
  expect(editor.api.getDocumentVersion()).toBe(initial);
  for (const label of ["Peer edit", "API"]) {
    const before = editor.api.getDocumentVersion();
    flow = { ...flow, nodes: flow.nodes.map((n) => ({ ...n, data: { ...n.data, label } }) as FlowNode) };
    editor.updateDeps(rf, deps());
    const after = editor.api.getDocumentVersion();
    expect(after.identity).toBe(initial.identity);
    expect(after.revision).toBeGreaterThan(before.revision);
  }
  expect(editor.api.getDocumentVersion()).not.toBe(initial);
});

it("saved caller edits stay editable before React commits the document metadata", () => {
  const diagram = breakerFixture();
  const flow = toFlow(diagram);
  const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as unknown as ReactFlowInstance<
    FlowNode,
    DiagramFlowEdge
  >;
  const editor = createEditor(rf, {
    meta: flow.meta,
    setMeta: vi.fn(),
    history: { hint: vi.fn() },
    nodeSize: { width: 220, height: 72 },
  } as unknown as EditorDeps).api;
  const controller = new LiveController(diagram, { replayDelayMs: 0 });
  controller.selectSimulation(diagram.simulations![0]);
  const live = { controller, slowmo: { active: false } };
  const editable: boolean[] = [];
  const stop = controller.subscribe(() => editable.push(effectiveCallerPolicy(editor, "call", live)!.editable));
  try {
    effectiveCallerPolicy(editor, "call", live)!.set({ breaker: null });
    expect(editor.getDiagram().simulations![0].setup?.edges?.call.caller?.breaker).toBeNull();
    expect(editable.length).toBeGreaterThan(0);
    expect(editable.every(Boolean)).toBe(true);
  } finally {
    stop();
    controller.dispose();
  }
});

it("metadata patches preserve other React updates already queued before the editor render", () => {
  const flow = toFlow(breakerFixture());
  let pending = { ...flow.meta, title: "Remote title" };
  const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as unknown as ReactFlowInstance<
    FlowNode,
    DiagramFlowEdge
  >;
  const editor = createEditor(rf, {
    meta: flow.meta,
    setMeta: (update: Parameters<EditorDeps["setMeta"]>[0]) => {
      pending = typeof update === "function" ? update(pending) : update;
    },
    history: { hint: vi.fn() },
  } as unknown as EditorDeps).api;
  editor.updateMeta({ description: "New description" });
  expect(editor.getDiagram().description).toBe("New description");
  expect(pending.title).toBe("Remote title");
  expect(pending.description).toBe("New description");
});
