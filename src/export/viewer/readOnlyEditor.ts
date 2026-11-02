import { useLayoutEffect, useState } from "react";
import { fromFlow } from "../../canvas/convert";
import { GROUP_PREFIX, isGroupNode } from "../../canvas/types";
import type { EditorDeps } from "../../editor/useEditor";
import type { ReactFlowInstance } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import type { EditorApi, Selection } from "../../editor/types";

type ReadOnlyDeps = Pick<
  EditorDeps,
  "meta" | "setNodes" | "setEdges" | "prefs" | "setPref" | "fit" | "zoom100" | "zoomTo" | "hovered" | "isPrivate"
> &
  Pick<ReactFlowInstance<FlowNode, DiagramFlowEdge>, "getNodes" | "getEdges">;

/** The file's canvas can read, focus and change its view, but has no document commands or history. */
export function createReadOnlyEditor(initial: ReadOnlyDeps) {
  let deps = initial;
  const version = { identity: {}, revision: 0 };
  const diagram = () => fromFlow(deps.meta, deps.getNodes(), deps.getEdges());
  const select = (selection: Partial<Selection>) => {
    const nodes = new Set(selection.nodeIds);
    const groups = new Set(selection.groupIds);
    const edges = new Set(selection.edgeIds);
    deps.setNodes((ns) =>
      ns.map((n) => {
        const selected = isGroupNode(n) ? groups.has(n.data.groupId) : nodes.has(n.id);
        return !!n.selected === selected ? n : { ...n, selected };
      }),
    );
    deps.setEdges((es) => es.map((e) => (!!e.selected === edges.has(e.id) ? e : { ...e, selected: edges.has(e.id) })));
  };
  const api = {
    getDocumentVersion: () => version,
    getDiagram: diagram,
    getNode: (id) => diagram().nodes.find((n) => n.id === id),
    getEdge: (id) => diagram().edges.find((e) => e.id === id),
    getGroup: (id) => diagram().groups?.find((g) => g.id === id),
    getAnnotation: (id) => diagram().annotations?.find((a) => a.id === id),
    getSelection: () => ({
      nodeIds: deps
        .getNodes()
        .filter((n) => !isGroupNode(n) && n.selected)
        .map((n) => n.id),
      groupIds: deps
        .getNodes()
        .filter(isGroupNode)
        .filter((n) => n.selected)
        .map((n) => n.data.groupId),
      edgeIds: deps
        .getEdges()
        .filter((e) => e.selected)
        .map((e) => e.id),
    }),
    select,
    clearSelection: () => select({}),
    canUndo: () => false,
    canRedo: () => false,
    hasClipboard: () => false,
    isPrivate: () => deps.isPrivate?.() ?? false,
    fitView: () => deps.fit(),
    zoomTo100: () => deps.zoom100?.(),
    zoomToSelection: () => {
      const selection = api.getSelection();
      const nodes = new Set([...selection.nodeIds, ...selection.groupIds.map((id) => GROUP_PREFIX + id)]);
      const edges = new Set(selection.edgeIds);
      const hovered = deps.hovered?.();
      if (!nodes.size && !edges.size && hovered) nodes.add(hovered);
      if ((!nodes.size && !edges.size) || !deps.zoomTo) return false;
      // eslint-disable-next-line no-restricted-syntax -- EditorDeps.zoomTo dispatches through the canvas camera; this is the viewer's editor adapter.
      deps.zoomTo(nodes, edges);
      return true;
    },
    get prefs() {
      return deps.prefs;
    },
    setPref: (key, value) => deps.setPref(key, value),
  } satisfies Pick<
    EditorApi,
    | "getDocumentVersion"
    | "getDiagram"
    | "getNode"
    | "getEdge"
    | "getGroup"
    | "getAnnotation"
    | "getSelection"
    | "select"
    | "clearSelection"
    | "canUndo"
    | "canRedo"
    | "hasClipboard"
    | "isPrivate"
    | "fitView"
    | "zoomTo100"
    | "zoomToSelection"
    | "prefs"
    | "setPref"
  >;
  return {
    api,
    updateDeps: (next: ReadOnlyDeps) => {
      deps = next;
    },
  };
}

/** Replaces useEditor only in the self-contained viewer build (scripts/interactive-viewer.ts). */
export function useEditor(deps: ReadOnlyDeps) {
  const [editor] = useState(() => createReadOnlyEditor(deps));
  useLayoutEffect(() => editor.updateDeps(deps));
  return editor.api;
}
