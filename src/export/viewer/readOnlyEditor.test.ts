// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { editorHarness } from "../../test/editorHarness";
import { fromFlow } from "../../canvas/convert";
import type { DiagramFile } from "../../model/types";
import { createReadOnlyEditor, useEditor } from "./readOnlyEditor";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Read-only navigation",
  nodes: [
    { id: "a", stencil: "service.go", label: "API", x: 0, y: 0, group: "g" },
    { id: "b", stencil: "postgres", label: "Store", x: 400, y: 0 },
  ],
  edges: [{ id: "e", from: "a", to: "b", kind: "sync" }],
  groups: [{ id: "g", label: "Services", x: -30, y: -30, width: 300, height: 200 }],
  annotations: [{ id: "note", kind: "note", text: "Read me", x: 0, y: 300, width: 240, height: 160 }],
};

function setup(input = diagram) {
  const h = editorHarness(input);
  Object.assign(h.deps, { zoom100: vi.fn(), zoomTo: vi.fn(), hovered: () => "b", setPref: vi.fn() });
  const deps = {
    ...h.deps,
    getNodes: h.nodes,
    getEdges: h.edges,
    zoom100: vi.fn(),
    zoomTo: vi.fn(),
    hovered: () => "b",
    setPref: vi.fn(),
  };
  return { h, deps, ...createReadOnlyEditor(deps) };
}

describe("the viewer's read-only canvas port", () => {
  it("keeps getters and keyboard selection without document commands or history", () => {
    const { h, api } = setup();
    const before = fromFlow(h.deps.meta, h.nodes(), h.edges());
    const version = api.getDocumentVersion();
    for (const selection of [{ nodeIds: ["a", "note"] }, { groupIds: ["g"], edgeIds: ["e"] }, {}]) {
      h.api.select(selection);
      const expected = h.api.getSelection();
      h.api.clearSelection();
      api.select(selection);
      expect(api.getSelection()).toEqual(expected);
      expect(api.getDiagram()).toEqual(before);
      expect(api.getDocumentVersion()).toBe(version);
    }
    expect(api.getNode("a")).toEqual(h.api.getNode("a"));
    expect(api.getEdge("e")).toEqual(h.api.getEdge("e"));
    expect(api.getGroup("g")).toEqual(h.api.getGroup("g"));
    expect(api.getAnnotation("note")).toEqual(h.api.getAnnotation("note"));
    api.clearSelection();
    expect(api.getSelection()).toEqual({ nodeIds: [], groupIds: [], edgeIds: [] });
    expect(api.canUndo()).toBe(false);
    expect(api.canRedo()).toBe(false);
    expect(api.hasClipboard()).toBe(false);
    for (const command of ["applyDiagram", "updateNode", "updateMeta", "deleteElements", "undo", "redo"])
      expect(api).not.toHaveProperty(command);
  });

  it("preserves fit, actual size and selection/hover zoom through the camera ports", () => {
    const { api, deps, h } = setup();
    api.fitView();
    api.zoomTo100();
    expect(deps.fit).toHaveBeenCalledOnce();
    expect(deps.zoom100).toHaveBeenCalledOnce();
    expect(api.zoomToSelection()).toBe(true);
    expect(deps.zoomTo).toHaveBeenLastCalledWith(new Set(["b"]), new Set());
    expect(h.api.zoomToSelection()).toBe(true);
    expect(deps.zoomTo.mock.lastCall).toEqual(vi.mocked(h.deps.zoomTo!).mock.lastCall);
    api.select({ edgeIds: ["e"] });
    expect(api.zoomToSelection()).toBe(h.api.zoomToSelection());
    expect(deps.zoomTo.mock.lastCall).toEqual(vi.mocked(h.deps.zoomTo!).mock.lastCall);
    expect(deps.zoomTo).toHaveBeenLastCalledWith(new Set(), new Set(["e"]));
  });

  it.each([false, true])("matches the editor camera for boundary selection (nested: %s)", (nested) => {
    const input: DiagramFile = nested
      ? {
          ...diagram,
          groups: [
            ...diagram.groups!,
            { id: "inner", group: "g", label: "Inner", x: 0, y: 0, width: 250, height: 150 },
          ],
          nodes: [...diagram.nodes, { id: "c", group: "inner", stencil: "service.go", label: "Worker", x: 0, y: 0 }],
          annotations: diagram.annotations!.map((a) => ({ ...a, group: "inner" })),
        }
      : diagram;
    const { api, deps, h } = setup(input);
    for (const groupIds of nested ? [["g"], ["inner"], ["g", "inner"]] : [["g"]]) {
      api.select({ groupIds, edgeIds: ["e"] });
      expect(api.zoomToSelection()).toBe(h.api.zoomToSelection());
      expect(deps.zoomTo.mock.lastCall).toEqual(vi.mocked(h.deps.zoomTo!).mock.lastCall);
      const members = nested ? ["c", "note", "group:inner"] : [];
      const outer = groupIds.includes("g") ? ["a", "group:g"] : [];
      expect(deps.zoomTo).toHaveBeenLastCalledWith(new Set([...outer, ...members]), new Set(["e"]));
    }
  });

  it("refreshes controlled state across hook rerenders", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    let api!: ReturnType<typeof useEditor>;
    function Harness({ deps }: { deps: Parameters<typeof useEditor>[0] }) {
      api = useEditor(deps);
      return null;
    }
    const initial = setup();
    const next = setup();
    next.h.api.select({ nodeIds: ["b", "note"], groupIds: ["g"], edgeIds: ["e"] });
    const prefs = { snap: false, grid: false, minimap: true, inspector: false };
    const deps = {
      ...next.deps,
      meta: { ...next.deps.meta, title: "Rerendered" },
      prefs,
      isPrivate: () => true,
      setNodes: vi.fn<Parameters<typeof useEditor>[0]["setNodes"]>(),
      setEdges: vi.fn<Parameters<typeof useEditor>[0]["setEdges"]>(),
    };
    try {
      await act(() => root.render(createElement(Harness, { deps: initial.deps })));
      const stable = api;
      expect(api.getSelection()).toEqual({ nodeIds: [], groupIds: [], edgeIds: [] });
      await act(() => root.render(createElement(Harness, { deps })));
      expect(api).toBe(stable);
      expect(api.getSelection()).toEqual({ nodeIds: ["b", "note"], groupIds: ["g"], edgeIds: ["e"] });
      expect(api.getDiagram().title).toBe("Rerendered");
      expect(api.prefs).toBe(prefs);
      expect(api.isPrivate()).toBe(true);
      api.fitView();
      api.zoomTo100();
      api.setPref("minimap", false);
      expect(api.zoomToSelection()).toBe(true);
      expect(deps.fit).toHaveBeenCalledOnce();
      expect(deps.zoom100).toHaveBeenCalledOnce();
      expect(deps.setPref).toHaveBeenCalledWith("minimap", false);
      expect(deps.zoomTo).toHaveBeenCalledWith(new Set(["a", "b", "note", "group:g"]), new Set(["e"]));
      api.select({ nodeIds: ["a"] });
      expect(deps.setNodes).toHaveBeenCalledOnce();
      expect(deps.setEdges).toHaveBeenCalledOnce();
      const nodes = deps.setNodes.mock.calls[0][0];
      const edges = deps.setEdges.mock.calls[0][0];
      expect(
        typeof nodes === "function" &&
          nodes(next.h.nodes())
            .filter((n) => n.selected)
            .map((n) => n.id),
      ).toEqual(["a"]);
      expect(typeof edges === "function" && edges(next.h.edges()).filter((e) => e.selected)).toEqual([]);
      for (const callback of [initial.deps.fit, initial.deps.zoom100, initial.deps.zoomTo, initial.deps.setPref])
        expect(callback).not.toHaveBeenCalled();
      await act(() => root.render(createElement(Harness, { deps: { ...initial.deps, hovered: () => "a" } })));
      expect(api).toBe(stable);
      expect(api.zoomToSelection()).toBe(true);
      expect(initial.deps.zoomTo).toHaveBeenCalledWith(new Set(["a"]), new Set());
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("refreshes factory dependencies without replacing the API", () => {
    const { api, deps, updateDeps } = setup();
    const prefs = { snap: false, grid: false, minimap: true, inspector: false };
    updateDeps({ ...deps, meta: { ...deps.meta, title: "Current title" }, prefs, hovered: () => undefined });
    expect(api.getDiagram().title).toBe("Current title");
    expect(api.prefs).toBe(prefs);
    api.setPref("minimap", false);
    expect(deps.setPref).toHaveBeenCalledWith("minimap", false);
    expect(api.zoomToSelection()).toBe(false);
  });
});
