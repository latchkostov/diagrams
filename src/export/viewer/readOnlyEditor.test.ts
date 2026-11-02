import { describe, expect, it, vi } from "vitest";
import { editorHarness } from "../../test/editorHarness";
import { fromFlow } from "../../canvas/convert";
import type { DiagramFile } from "../../model/types";
import { createReadOnlyEditor } from "./readOnlyEditor";

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

function setup() {
  const h = editorHarness(diagram);
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
    const { api, deps } = setup();
    api.fitView();
    api.zoomTo100();
    expect(deps.fit).toHaveBeenCalledOnce();
    expect(deps.zoom100).toHaveBeenCalledOnce();
    expect(api.zoomToSelection()).toBe(true);
    expect(deps.zoomTo).toHaveBeenLastCalledWith(new Set(["b"]), new Set());
    api.select({ groupIds: ["g"], edgeIds: ["e"] });
    expect(api.zoomToSelection()).toBe(true);
    expect(deps.zoomTo).toHaveBeenLastCalledWith(new Set(["group:g"]), new Set(["e"]));
  });

  it("reads current controlled state and preferences after a render", () => {
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
