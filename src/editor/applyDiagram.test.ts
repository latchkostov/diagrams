import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { DiagramFile } from "../model/types";
import { createEditor, type EditorDeps } from "./useEditor";
import { diagramDiff } from "./diagramDiff";
import { commit, commitReplacement, createHistory, present, redo, undo } from "./history";
import { editMessageProps, messageRules } from "../model/messageRules";

const original = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Original",
  nodes: [{ id: "a", stencil: "service.dotnet", label: "A", x: 40, y: 40 }],
  edges: [],
});

describe("immediate AI document replacement", () => {
  it("uses structural no-op detection without writing history for reordered JSON keys", () => {
    const flow = toFlow(original()),
      replace = vi.fn();
    const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<
      FlowNode,
      DiagramFlowEdge
    >;
    const editor = createEditor(rf, { meta: flow.meta, history: { replace } } as unknown as EditorDeps);
    const d = editor.api.getDiagram();
    const reordered = {
      edges: d.edges,
      nodes: d.nodes.map((n) => ({ y: n.y, x: n.x, label: n.label, stencil: n.stencil, id: n.id })),
      title: d.title,
      format: d.format,
    };
    expect(editor.api.applyDiagram(reordered).hasChanges).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
  it("replaces one snapshot, returns diff ids/counts, and round-trips all document kinds", () => {
    let flow = toFlow(original());
    const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<
      FlowNode,
      DiagramFlowEdge
    >;
    const replace = vi.fn((next: typeof flow, _merge?: string) => {
      flow = next;
      editor.updateDeps(rf, { ...deps, meta: flow.meta });
    });
    const deps = { meta: flow.meta, history: { replace } } as unknown as EditorDeps;
    const editor = createEditor(rf, deps);
    const next: DiagramFile = {
      ...original(),
      title: "AI",
      direction: "TB",
      nodes: [
        { ...original().nodes[0], label: "Changed" },
        { id: "b", stencil: "postgres", label: "B", x: 40, y: 400, group: "g" },
      ],
      edges: [{ id: "e", from: "a", to: "b", kind: "sync" }],
      groups: [{ id: "g", label: "Data", x: 0, y: 350, width: 300, height: 160 }],
      annotations: [{ id: "n", kind: "note", text: "Details", x: 400, y: 40, width: 240, height: 160 }],
      simulations: [{ id: "sim", title: "Load", traffic: [] }],
    };
    const diff = editor.api.applyDiagram(next, { merge: "ai:turn-1" });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][1]).toBe("ai:turn-1");
    expect(diff.added).toMatchObject({
      count: 5,
      nodes: ["b"],
      edges: ["e"],
      groups: ["g"],
      annotations: ["n"],
      simulations: ["sim"],
    });
    expect(diff.updated.ids).toEqual(["a"]);
    expect(diff.metaChanged).toBe(true);
    expect(editor.api.getDiagram()).toMatchObject(next);
  });
  it("keeps runtime rule identities when an unrelated proposal follows a rule removal (R-3f4bf4b104)", () => {
    const legacy = original();
    legacy.nodes.push({
      id: "p",
      stencil: "service.go",
      label: "P",
      x: 400,
      y: 40,
      props: { emits: { A: "B", C: "D" } },
    });
    const props = legacy.nodes[1].props!;
    const rows = messageRules(props.emits);
    legacy.nodes[1].props = editMessageProps({ emits: rows.filter((rule) => rule.receives !== "A") }, props);
    let flow = toFlow(legacy);
    const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<
      FlowNode,
      DiagramFlowEdge
    >;
    const replace = vi.fn((next: typeof flow) => {
      flow = next;
      editor.updateDeps(rf, { ...deps, meta: flow.meta });
    });
    const deps = { meta: flow.meta, history: { replace } } as unknown as EditorDeps;
    const editor = createEditor(rf, deps);
    const current = editor.api.getDiagram();
    const diff = editor.api.applyDiagram({
      ...current,
      nodes: current.nodes.map((node) => (node.id === "a" ? { ...node, label: "Renamed" } : node)),
    });
    expect(diff.updated.ids).toEqual(["a"]);
    const processor = editor.api.getNode("p")!;
    expect(processor.props?.emits).toEqual({ C: "D" });
    expect(messageRules(processor.props?.emits).map((rule) => rule.id)).toEqual([rows[1].id]);
  });
  it("does not write an invalid diagram", () => {
    const flow = toFlow(original()),
      replace = vi.fn();
    const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<
      FlowNode,
      DiagramFlowEdge
    >;
    const editor = createEditor(rf, { meta: flow.meta, history: { replace } } as unknown as EditorDeps);
    expect(() =>
      editor.api.applyDiagram({ ...original(), edges: [{ id: "bad", from: "a", to: "missing" }] }),
    ).toThrow();
    expect(replace).not.toHaveBeenCalled();
    expect(editor.api.getDiagram()).toMatchObject(original());
  });
  it("reports added, changed, and removed entities independently", () => {
    const d = original();
    d.annotations = [{ id: "n", kind: "note", text: "Old", x: 0, y: 0, width: 200, height: 100 }];
    const diff = diagramDiff(d, {
      ...d,
      annotations: [{ ...d.annotations[0], text: "New" }],
      nodes: [{ id: "b", stencil: "postgres", label: "B", x: 0, y: 0 }],
    });
    expect(diff.added.ids).toEqual(["b"]);
    expect(diff.updated.ids).toEqual(["n"]);
    expect(diff.removed.ids).toEqual(["a"]);
  });
  it("flushes an uncommitted user edit and isolates both sides of an AI step", () => {
    const entry = (key: string, tag: string) => ({ key, value: key, mergeKey: tag, at: 100 });
    let h = createHistory("start", "start");
    h = commitReplacement(h, entry("user-before", "drag"), entry("AI", "ai:1"));
    expect(h.entries.map((e) => e.key)).toEqual(["start", "user-before", "AI"]);
    expect(present(undo(h)).value).toBe("user-before");
    h = commit(h, entry("user-after", "ai:1"));
    expect(h.entries.map((e) => e.key)).toEqual(["start", "user-before", "AI", "user-after"]);
    expect(present(undo(h)).value).toBe("AI");
    expect(present(undo(undo(h))).value).toBe("user-before");
    expect(present(redo(undo(h))).value).toBe("user-after");
  });
  it("keeps rapid AI calls separate even when the merge id is repeated", () => {
    const entry = (key: string) => ({ key, value: key, mergeKey: "ai:same", at: 100 });
    const first = commitReplacement(createHistory("start", "start"), entry("start"), entry("one"));
    const second = commitReplacement(first, entry("one"), entry("two"));
    expect(second.entries.map((e) => e.key)).toEqual(["start", "one", "two"]);
    expect(present(undo(second)).value).toBe("one");
  });
});

it("a fresh sandbox resets history even when its document already equals the initial diagram", () => {
  const flow = toFlow(original());
  const replace = vi.fn();
  const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const editor = createEditor(rf, { meta: flow.meta, history: { replace } } as unknown as EditorDeps);
  const before = editor.api.getDiagram();
  expect(editor.api.applyDiagram(before, { resetHistory: true }).hasChanges).toBe(false);
  expect(replace).toHaveBeenCalledExactlyOnceWith(toFlow(before), undefined, toFlow(before), true);
});
