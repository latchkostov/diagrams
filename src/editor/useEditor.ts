import { useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useReactFlow, type ReactFlowInstance } from "@xyflow/react";
import {
  annotationToFlow,
  edgeToFlow,
  fromFlow,
  groupAt,
  groupToFlow,
  nodeToFlow,
  type DiagramMeta,
} from "../canvas/convert";
import { annotationIdBase, defaultSize, defaultText, isConnectable, textSizePx } from "../canvas/annotations";
import { placeFree, type Box as PlaceBox } from "../canvas/placement";
import type { EditTarget } from "../canvas/DiagramContext";
import {
  type AnnotationFlowNode,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type FlowNode,
  type GroupFlowNode,
} from "../canvas/types";
import { toneLabel } from "../canvas/groupTones";
import { getStencil } from "../stencils/registry";
import { downloadDiagram, isOwnSlug } from "../lib/diagramIO";
import { motionMs } from "../lib/motion";
import { align, boundaryAround, distribute, type Box, type Positions } from "./arrange";
import { makePayload, parsePayload, payloadOrigin, remapPayload, type ClipboardPayload } from "./clipboard";
import { stencilIdBase, uniqueId } from "./ids";
import { layeredLayout } from "./layout";
import type { HistoryApi } from "./useHistory";
import type { EditorApi, EditorPrefs, Selection, XY } from "./types";

// The EditorApi implementation over React Flow state. Built once per canvas; reads the latest
// committed props so menus / shortcuts never see stale state.

/** Internal clipboard, shared across diagrams in this tab. Mirrored to the system clipboard. */
let clipboard: ClipboardPayload | null = null;
let pasteCount = 0;

const PASTE_STEP = 30;

export interface EditorDeps {
  slug: string;
  meta: DiagramMeta;
  setMeta: Dispatch<SetStateAction<DiagramMeta>>;
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<DiagramFlowEdge[]>>;
  history: HistoryApi;
  prefs: EditorPrefs;
  setPref: <K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) => void;
  setEditing: (t: EditTarget | null) => void;
  openInspector: (focusField?: string) => void;
  showShortcuts: () => void;
  /** Centre of the visible canvas, in flow coordinates. */
  viewCenter: () => XY;
  /** The pointer over the canvas, in flow coordinates (undefined when it's elsewhere). */
  pointer?: () => XY | undefined;
  /** Small boxes along the drawn edges (flow coordinates), so new things are placed off them. */
  edgeMarks?: () => PlaceBox[];
  fit: () => void;
  /** Nominal node size for the current renderer (before React Flow has measured). */
  nodeSize: { width: number; height: number };
}

export function useEditor(deps: EditorDeps): EditorApi {
  const rf = useReactFlow<FlowNode, DiagramFlowEdge>();
  const [editor] = useState(() => createEditor(rf, deps));
  useLayoutEffect(() => {
    editor.updateDeps(rf, deps);
  });
  return editor.api;
}

const isDiagram = (n: FlowNode): n is DiagramFlowNode => n.type === "diagram";
const isGroup = (n: FlowNode): n is GroupFlowNode => n.type === "boundary";
const isAnnotation = (n: FlowNode): n is AnnotationFlowNode => n.type === "annotation";
/** Things that sit at a place and can be arranged: nodes and annotations (not boundaries). */
const isPlaced = (n: FlowNode): n is DiagramFlowNode | AnnotationFlowNode => n.type !== "boundary";
const snap10 = (v: number) => Math.round(v / 10) * 10;

function withoutUndefined<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

function createEditor(rf: ReactFlowInstance<FlowNode, DiagramFlowEdge>, initialDeps: EditorDeps) {
  let latest = initialDeps;
  const deps = () => latest;
  const box = (n: FlowNode): Box => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? deps().nodeSize.width,
    height: n.measured?.height ?? n.height ?? deps().nodeSize.height,
  });
  const diagram = () => fromFlow(deps().meta, rf.getNodes(), rf.getEdges());
  const members = (groupId: string) =>
    rf.getNodes().filter((n): n is DiagramFlowNode => isDiagram(n) && n.data.group === groupId);
  const hint = (merge?: string) => deps().history.hint(merge);

  const setSelected = (sel: Partial<Selection>) => {
    const nodes = new Set(sel.nodeIds ?? []);
    const groups = new Set(sel.groupIds ?? []);
    const edges = new Set(sel.edgeIds ?? []);
    deps().setNodes((ns) =>
      ns.map((n) => {
        const want = isGroup(n) ? groups.has(n.data.groupId) : nodes.has(n.id);
        return !!n.selected === want ? n : { ...n, selected: want };
      }),
    );
    deps().setEdges((es) =>
      es.map((e) => (!!e.selected === edges.has(e.id) ? e : { ...e, selected: edges.has(e.id) })),
    );
  };

  const movePositions = (pos: Positions) => {
    if (!pos.size) return;
    deps().setNodes((ns) =>
      ns.map((n) => {
        const p = pos.get(n.id);
        return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n;
      }),
    );
  };

  const insert = (p: ClipboardPayload, offset: XY) => {
    const ns = rf.getNodes();
    const taken = {
      nodes: new Set(ns.filter(isPlaced).map((n) => n.id)),
      groups: new Set(ns.filter(isGroup).map((n) => n.data.groupId)),
      edges: new Set(rf.getEdges().map((e) => e.id)),
    };
    const r = remapPayload(p, taken, { x: snap10(offset.x), y: snap10(offset.y) });
    const newGroups = new Set(r.groups.map((g) => g.id));
    const groupNodes = r.groups.map((g) => ({ ...groupToFlow(g), selected: true }));
    const all = [...ns, ...groupNodes];
    const { width, height } = deps().nodeSize;
    const nodes = r.nodes.map((n): DiagramFlowNode => {
      const f = nodeToFlow(n);
      const group = n.group && newGroups.has(n.group) ? n.group : groupAt(all, n.x + width / 2, n.y + height / 2);
      return { ...f, data: { ...f.data, group }, selected: true };
    });
    const notes = (r.annotations ?? []).map((a) => ({ ...annotationToFlow(a), selected: true }));
    deps().setNodes((cur) => [
      ...notes.filter((n) => n.data.kind === "zone"),
      ...cur.map((n) => (n.selected ? { ...n, selected: false } : n)),
      ...groupNodes,
      ...nodes,
      ...notes.filter((n) => n.data.kind !== "zone"),
    ]);
    deps().setEdges((cur) => [
      ...cur.map((e) => (e.selected ? { ...e, selected: false } : e)),
      ...r.edges.map(edgeToFlow),
    ]);
  };

  const readSystemClipboard = async (): Promise<ClipboardPayload | null> => {
    try {
      const text = await navigator.clipboard?.readText();
      return text ? parsePayload(text) : null;
    } catch {
      return null;
    }
  };

  const api: EditorApi = {
    getDiagram: diagram,
    getNode: (id) => diagram().nodes.find((n) => n.id === id),
    getEdge: (id) => diagram().edges.find((e) => e.id === id),
    getGroup: (id) => diagram().groups?.find((g) => g.id === id),
    getAnnotation: (id) => diagram().annotations?.find((a) => a.id === id),
    getSelection: () => {
      const ns = rf.getNodes();
      return {
        nodeIds: ns.filter((n) => isPlaced(n) && n.selected).map((n) => n.id),
        groupIds: ns
          .filter(isGroup)
          .filter((n) => n.selected)
          .map((n) => n.data.groupId),
        edgeIds: rf
          .getEdges()
          .filter((e) => e.selected)
          .map((e) => e.id),
      };
    },

    select: setSelected,
    selectAll: () => {
      const ns = rf.getNodes();
      setSelected({
        nodeIds: ns.filter(isPlaced).map((n) => n.id),
        groupIds: ns.filter(isGroup).map((n) => n.data.groupId),
        edgeIds: rf.getEdges().map((e) => e.id),
      });
    },
    clearSelection: () => setSelected({}),

    addNode: (stencilId, at) => {
      const s = getStencil(stencilId);
      const { width, height } = deps().nodeSize;
      const ns = rf.getNodes();
      // No spot given (a click in the rail or the palette): the free place nearest the view's centre.
      const c =
        at ?? placeFree(deps().viewCenter(), { width, height }, [...ns.map(box), ...(deps().edgeMarks?.() ?? [])]);
      const id = uniqueId(stencilIdBase(s.id), new Set(ns.map((n) => n.id)));
      const node: DiagramFlowNode = {
        id,
        type: "diagram",
        position: { x: snap10(c.x - width / 2), y: snap10(c.y - height / 2) },
        selected: true,
        data: { stencil: s.id, label: s.label, sublabel: s.defaultSublabel, group: groupAt(ns, c.x, c.y) },
      };
      deps().setNodes((cur) => [...cur.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
      deps().setEdges((cur) => cur.map((e) => (e.selected ? { ...e, selected: false } : e)));
      return id;
    },

    addAnnotation: (kind, opts = {}) => {
      const size = defaultSize[kind];
      const ns = rf.getNodes();
      const pointed = opts.at ?? (opts.atPointer ? deps().pointer?.() : undefined);
      // No spot given (a click in the rail or the palette): the free place nearest the view's centre,
      // so it never lands on a node (notes and shapes would push edges around) or on the last one added.
      const c = pointed ?? placeFree(deps().viewCenter(), size, [...ns.map(box), ...(deps().edgeMarks?.() ?? [])]);
      const id = uniqueId(annotationIdBase(kind), new Set(ns.map((n) => n.id)));
      // Text starts where you pointed (its first line under the cursor); the rest centre on it.
      const x = kind === "text" && pointed ? c.x - 8 : c.x - size.width / 2;
      const y = c.y - size.height / 2;
      const node: AnnotationFlowNode = {
        ...annotationToFlow({
          id,
          kind,
          text: defaultText[kind],
          x: snap10(x),
          y: snap10(y),
          ...size,
          ...(kind === "shape" ? { shape: opts.shape ?? "rect" } : {}),
        }),
        selected: true,
      };
      deps().setNodes((cur) => {
        const rest = cur.map((n) => (n.selected ? { ...n, selected: false } : n));
        // Zones go to the back (they're backgrounds); everything else on top.
        return kind === "zone" ? [node, ...rest] : [...rest, node];
      });
      deps().setEdges((cur) => cur.map((e) => (e.selected ? { ...e, selected: false } : e)));
      if (kind !== "shape") deps().setEditing({ kind: "annotation", id });
      return id;
    },
    updateAnnotation: (id, patch, opts) => {
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id || !isAnnotation(n)) return n;
          const data = { ...n.data };
          if ("text" in patch) data.text = patch.text ?? "";
          if ("color" in patch) data.color = patch.color;
          if ("textSize" in patch) data.textSize = patch.textSize;
          if ("shape" in patch && data.kind === "shape") data.shape = patch.shape;
          const kind = patch.kind ?? data.kind;
          data.kind = kind;
          if (kind !== "shape") data.shape = undefined;
          let width = patch.width ?? n.width;
          let height = patch.height ?? n.height;
          // Text has no frame to fill: a new text size scales its box with the type, so a one-line
          // title stays one line (instead of wrapping and spilling out of a box sized for 14px).
          if (kind === "text" && "textSize" in patch && patch.width === undefined && patch.height === undefined) {
            const r = textSizePx[data.textSize ?? "m"] / textSizePx[n.data.textSize ?? "m"];
            if (r !== 1 && width && height) {
              width = Math.round(width * r);
              height = Math.round(height * r);
            }
          }
          return {
            ...n,
            data,
            connectable: isConnectable(kind),
            position: { x: patch.x ?? n.position.x, y: patch.y ?? n.position.y },
            width,
            height,
          };
        }),
      );
      // A shape that stops being a shape can't keep its edges.
      if (patch.kind && !isConnectable(patch.kind))
        deps().setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    },

    updateNode: (id, patch, opts) => {
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id || !isDiagram(n)) return n;
          const data = { ...n.data };
          if ("stencil" in patch && patch.stencil) data.stencil = patch.stencil;
          if ("label" in patch) data.label = patch.label ?? "";
          if ("sublabel" in patch) data.sublabel = patch.sublabel || undefined;
          if ("group" in patch) data.group = patch.group || undefined;
          if ("props" in patch) data.props = patch.props && withoutUndefined(patch.props);
          const position = { x: patch.x ?? n.position.x, y: patch.y ?? n.position.y };
          return { ...n, data, position };
        }),
      );
    },
    setNodeProps: (id, patch, opts) => {
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) =>
          n.id === id && isDiagram(n)
            ? { ...n, data: { ...n.data, props: withoutUndefined({ ...n.data.props, ...patch }) } }
            : n,
        ),
      );
    },
    updateEdge: (id, patch, opts) => {
      hint(opts?.merge);
      deps().setEdges((es) =>
        es.map((e) => {
          if (e.id !== id) return e;
          const data = { kind: "async" as const, ...e.data };
          if ("label" in patch) data.label = patch.label || undefined;
          if ("kind" in patch) data.kind = patch.kind ?? "async";
          if ("sourceSide" in patch) data.sourceSide = patch.sourceSide;
          if ("targetSide" in patch) data.targetSide = patch.targetSide;
          if ("props" in patch) data.props = patch.props && withoutUndefined(patch.props);
          return { ...e, source: patch.from ?? e.source, target: patch.to ?? e.target, data };
        }),
      );
    },
    setEdgeProps: (id, patch, opts) => {
      hint(opts?.merge);
      deps().setEdges((es) =>
        es.map((e) =>
          e.id === id
            ? {
                ...e,
                data: { kind: "async" as const, ...e.data, props: withoutUndefined({ ...e.data?.props, ...patch }) },
              }
            : e,
        ),
      );
    },
    updateGroup: (id, patch, opts) => {
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) => {
          if (!isGroup(n) || n.data.groupId !== id) return n;
          return {
            ...n,
            position: { x: patch.x ?? n.position.x, y: patch.y ?? n.position.y },
            width: patch.width ?? n.width,
            height: patch.height ?? n.height,
            data: { ...n.data, label: patch.label ?? n.data.label, tone: patch.tone ?? n.data.tone },
          };
        }),
      );
    },
    updateMeta: (patch, opts) => {
      hint(opts?.merge);
      deps().setMeta((m) => ({ ...m, ...patch }));
    },
    connect: (from, to) => {
      if (from === to) return null;
      const es = rf.getEdges();
      const existing = es.find((e) => e.source === from && e.target === to);
      if (existing) return existing.id;
      const id = uniqueId("e", new Set(es.map((e) => e.id)));
      deps().setEdges((cur) => [...cur, { id, source: from, target: to, type: "flow", data: { kind: "async" } }]);
      return id;
    },
    reverseEdge: (id) => {
      deps().setEdges((es) =>
        es.map((e) =>
          e.id === id
            ? {
                ...e,
                source: e.target,
                target: e.source,
                data: {
                  kind: "async" as const,
                  ...e.data,
                  sourceSide: e.data?.targetSide,
                  targetSide: e.data?.sourceSide,
                },
              }
            : e,
        ),
      );
    },

    deleteElements: (sel) => {
      const nodeIds = new Set(sel.nodeIds ?? []);
      const groupIds = new Set(sel.groupIds ?? []);
      const edgeIds = new Set(sel.edgeIds ?? []);
      if (!nodeIds.size && !groupIds.size && !edgeIds.size) return;
      deps().setEditing(null);
      deps().setNodes((ns) =>
        ns
          .filter((n) => (isGroup(n) ? !groupIds.has(n.data.groupId) : !nodeIds.has(n.id)))
          .map((n) =>
            isDiagram(n) && n.data.group && groupIds.has(n.data.group)
              ? { ...n, data: { ...n.data, group: undefined } }
              : n,
          ),
      );
      deps().setEdges((es) => es.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)));
    },
    duplicate: (sel) => {
      const p = makePayload(diagram(), sel.nodeIds ?? [], sel.groupIds ?? []);
      if (p) insert(p, { x: PASTE_STEP, y: PASTE_STEP });
    },
    align: (ids, mode) => {
      const set = new Set(ids);
      movePositions(
        align(
          rf
            .getNodes()
            .filter((n) => set.has(n.id) && isPlaced(n))
            .map(box),
          mode,
        ),
      );
    },
    distribute: (ids, axis) => {
      const set = new Set(ids);
      movePositions(
        distribute(
          rf
            .getNodes()
            .filter((n) => set.has(n.id) && isPlaced(n))
            .map(box),
          axis,
        ),
      );
    },
    groupNodes: (ids, tone = "neutral") => {
      const set = new Set(ids);
      const nodes = rf.getNodes().filter((n) => set.has(n.id) && isDiagram(n));
      if (!nodes.length) return null;
      const ns = rf.getNodes();
      const id = uniqueId("boundary", new Set(ns.filter(isGroup).map((n) => n.data.groupId)));
      const group = groupToFlow({ id, label: toneLabel[tone], tone, ...boundaryAround(nodes.map(box)) });
      deps().setNodes((cur) => [
        { ...group, selected: true },
        ...cur.map((n) => {
          const next = isDiagram(n) && set.has(n.id) ? { ...n, data: { ...n.data, group: id } } : n;
          return next.selected ? { ...next, selected: false } : next;
        }),
      ]);
      deps().setEditing({ kind: "group", id });
      return id;
    },
    ungroup: (groupId) => {
      deps().setNodes((ns) =>
        ns
          .filter((n) => !(isGroup(n) && n.data.groupId === groupId))
          .map((n) => (isDiagram(n) && n.data.group === groupId ? { ...n, data: { ...n.data, group: undefined } } : n)),
      );
    },
    deleteGroupWithContents: (groupId) => {
      api.deleteElements({ groupIds: [groupId], nodeIds: members(groupId).map((n) => n.id) });
    },
    fitGroupToContents: (groupId) => {
      const m = members(groupId);
      if (m.length) api.updateGroup(groupId, boundaryAround(m.map(box)));
    },
    bringToFront: (ids) => {
      const set = new Set(ids);
      deps().setNodes((ns) => [...ns.filter((n) => !set.has(n.id)), ...ns.filter((n) => set.has(n.id))]);
    },
    sendToBack: (ids) => {
      const set = new Set(ids);
      // Behind the other nodes and annotations, never behind zones and boundaries (the backdrops).
      const backdrop = (n: FlowNode) => isGroup(n) || (isAnnotation(n) && n.data.kind === "zone");
      deps().setNodes((ns) => [
        ...ns.filter((n) => backdrop(n) && set.has(n.id)),
        ...ns.filter((n) => backdrop(n) && !set.has(n.id)),
        ...ns.filter((n) => !backdrop(n) && set.has(n.id)),
        ...ns.filter((n) => !backdrop(n) && !set.has(n.id)),
      ]);
    },
    moveSelection: (dx, dy) => {
      const ns = rf.getNodes();
      const groups = new Set(ns.filter((n) => isGroup(n) && n.selected).map((n) => (n as GroupFlowNode).data.groupId));
      const moving = new Set(
        ns
          .filter((n) => n.selected || (isDiagram(n) && n.data.group !== undefined && groups.has(n.data.group)))
          .map((n) => n.id),
      );
      if (!moving.size) return;
      hint("nudge");
      deps().setNodes((cur) =>
        cur.map((n) => (moving.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
      );
    },

    copy: (sel) => {
      const p = makePayload(diagram(), sel.nodeIds ?? [], sel.groupIds ?? []);
      if (!p) return;
      clipboard = p;
      pasteCount = 0;
      navigator.clipboard?.writeText(JSON.stringify(p, null, 2)).catch(() => {});
    },
    cut: (sel) => {
      api.copy(sel);
      const groupIds = sel.groupIds ?? [];
      const nodeIds = [...(sel.nodeIds ?? []), ...groupIds.flatMap((g) => members(g).map((n) => n.id))];
      api.deleteElements({ nodeIds, groupIds, edgeIds: sel.edgeIds });
    },
    paste: async (at) => {
      const p = clipboard ?? (await readSystemClipboard());
      if (p) api.pastePayload(p, at);
    },
    pastePayload: (p, at) => {
      if (at) {
        const o = payloadOrigin(p);
        insert(p, { x: at.x - o.x, y: at.y - o.y });
        return;
      }
      pasteCount++;
      insert(p, { x: PASTE_STEP * pasteCount, y: PASTE_STEP * pasteCount });
    },
    hasClipboard: () => clipboard !== null,

    undo: () => deps().history.undo(),
    redo: () => deps().history.redo(),
    canUndo: () => deps().history.canUndo,
    canRedo: () => deps().history.canRedo,

    fitView: () => deps().fit(),
    zoomTo100: () => void rf.zoomTo(1, { duration: motionMs(250) }),
    get prefs() {
      return deps().prefs;
    },
    setPref: (key, value) => deps().setPref(key, value),
    startEditing: (target) => deps().setEditing(target),
    openInspector: (field) => deps().openInspector(field),
    showShortcuts: () => deps().showShortcuts(),
    exportJson: () => {
      const d = diagram();
      const slug = deps().slug;
      const name = isOwnSlug(slug)
        ? d.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
        : slug;
      downloadDiagram(d, name || "diagram");
    },
    autoLayout: () => {
      const d = diagram();
      const pos = layeredLayout({ nodes: d.nodes, edges: d.edges, direction: d.direction });
      movePositions(pos);
      // Refit boundaries around their (moved) members.
      const { width, height } = deps().nodeSize;
      for (const g of d.groups ?? []) {
        const boxes = d.nodes
          .filter((n) => n.group === g.id && pos.has(n.id))
          .map((n) => {
            const measured = rf.getNode(n.id);
            return {
              id: n.id,
              ...pos.get(n.id)!,
              width: measured?.measured?.width ?? width,
              height: measured?.measured?.height ?? height,
            };
          });
        if (boxes.length) api.updateGroup(g.id, boundaryAround(boxes));
      }
      setTimeout(() => deps().fit(), 60);
    },
  };
  return {
    api,
    updateDeps: (flow: ReactFlowInstance<FlowNode, DiagramFlowEdge>, next: EditorDeps) => {
      rf = flow;
      latest = next;
    },
  };
}
