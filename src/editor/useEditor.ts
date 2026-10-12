import { useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useReactFlow, type ReactFlowInstance } from "@xyflow/react";
import { flushSync } from "react-dom";
import {
  annotationToFlow,
  edgeToFlow,
  fromFlow,
  groupAt,
  groupToFlow,
  nodeToFlow,
  toFlow,
  type DiagramMeta,
} from "../canvas/convert";
import {
  annotationIdBase,
  defaultSize,
  defaultText,
  isConnectable,
  isObstacle,
  textSizePx,
} from "../canvas/annotations";
import {
  ANNOTATION_LIMITS,
  annotationGeometryError,
  annotationSize,
  annotationCoordinate,
  annotationText,
} from "../model/annotations";
import { foregroundLayerOrder } from "../model/layers";
import { notify } from "../interop/ui/toast";
import { isDependency, relationOf, RELATION_META, type DependencyRelation } from "../model/relations";
import { inferRelation } from "../stencils/relations";
import {
  boundsOf,
  clearOffset,
  pastAll,
  COPY_MARGIN,
  isClear,
  overlaps,
  placeCopy,
  placeFree,
  type Box as PlaceBox,
} from "../canvas/placement";
import type { EditTarget } from "../canvas/DiagramContext";
import {
  GROUP_PREFIX,
  type AnnotationFlowNode,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type FlowNode,
  type GroupFlowNode,
} from "../canvas/types";
import { toneLabel } from "../canvas/groupTones";
import type { EdgeMark } from "../canvas/edgeMarks";
import { getStencil } from "../stencils/registry";
import { downloadDiagram, isOwnSlug } from "../lib/diagramIO";
import { motionMs } from "../lib/motion";
import { align, boundaryAround, distribute, type Box, type Positions } from "./arrange";
import { makePayload, parsePayload, remapPayload, type ClipboardPayload } from "./clipboard";
import { stencilIdBase, uniqueId } from "./ids";
import { layeredLayout } from "./layout";
import type { HistoryApi } from "./useHistory";
import type { EditorApi, EditorPrefs, Selection, XY } from "./types";
import { diagramDiff } from "./diagramDiff";
import { validateDiagram } from "../interop/native";

// The EditorApi implementation over React Flow state. Built once per canvas; reads the latest
// committed props so menus / shortcuts never see stale state.

/** Internal clipboard, shared across diagrams in this tab. Mirrored to the system clipboard. */
let clipboard: ClipboardPayload | null = null;

const selectionKey = (sel: Partial<Selection>) =>
  [...(sel.nodeIds ?? []), ...(sel.groupIds ?? []).map((g) => GROUP_PREFIX + g)].sort().join(" ");

/** Relationships already explained by a toast in this session (each one is taught once). */
const explained = new Set<DependencyRelation>();

/** The first time a relationship is inferred: say what it means, with a way back to a flow. */
function explainInference(relation: DependencyRelation, makeFlow: () => void): void {
  if (explained.has(relation)) return;
  explained.add(relation);
  notify(`${RELATION_META[relation].noun}: no messages flow here`, {
    action: { label: "Make it a flow", run: makeFlow, testId: "toast-make-flow" },
  });
}

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
  edgeMarks?: () => EdgeMark[];
  fit: () => void;
  /** Nominal node size for the current renderer (before React Flow has measured). */
  nodeSize: { width: number; height: number };
  /** Fits these nodes (flow ids) in the view, clear of the panels. */
  zoomTo?: (nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>) => void;
  /** The node under the pointer, if any (Shift+2 with nothing selected). */
  hovered?: () => string | undefined;
  /** Brings the selection into view once it's measured (a copy or a paste may land off screen). */
  reveal?: () => void;
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

export function createEditor(rf: ReactFlowInstance<FlowNode, DiagramFlowEdge>, initialDeps: EditorDeps) {
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
  /**
   * This editor's last Ctrl+D: the box it copied (`from`), where the copy went (`at`) and the copy's
   * selection. Ctrl+D again on that copy repeats the step, or the gap the person chose by moving the copy
   * first (Figma's smart duplicate). Per editor, so another diagram's ids never inherit it.
   */
  let lastDuplicate: { key: string; from: PlaceBox; at: PlaceBox } | null = null;

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

  /** Inserts a payload moved by `offset`, selected. Returns old flow id → new flow id (null: refused). */
  const insert = (p: ClipboardPayload, offset: XY): Map<string, string> | null => {
    const ns = rf.getNodes();
    if (ns.filter(isAnnotation).length + (p.annotations?.length ?? 0) > ANNOTATION_LIMITS.maxAnnotations) return null;
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
    const foreground = new Map([...nodes, ...notes.filter((n) => n.data.kind !== "zone")].map((n) => [n.id, n]));
    deps().setNodes((cur) => [
      ...notes.filter((n) => n.data.kind === "zone"),
      ...cur.map((n) => (n.selected ? { ...n, selected: false } : n)),
      ...groupNodes,
      ...foregroundLayerOrder(r).map((id) => foreground.get(id)!),
    ]);
    deps().setEdges((cur) => [
      ...cur.map((e) => (e.selected ? { ...e, selected: false } : e)),
      ...r.edges.map(edgeToFlow),
    ]);
    const ids = new Map<string, string>();
    p.nodes.forEach((n, i) => ids.set(n.id, r.nodes[i].id));
    (p.annotations ?? []).forEach((a, i) => ids.set(a.id, r.annotations![i].id));
    p.groups.forEach((g, i) => ids.set(GROUP_PREFIX + g.id, groupNodes[i].id));
    return ids;
  };

  /** A node's size on screen by flow id (nominal before React Flow has measured it). */
  const sizeOf = (id: string, fallback: { width: number; height: number }) => {
    const n = rf.getNode(id);
    return {
      width: n?.measured?.width ?? n?.width ?? fallback.width,
      height: n?.measured?.height ?? n?.height ?? fallback.height,
    };
  };
  /** The payload's boxes where they were copied from. */
  const payloadBoxes = (p: ClipboardPayload): PlaceBox[] => [
    ...p.nodes.map((n) => ({ x: n.x, y: n.y, ...sizeOf(n.id, deps().nodeSize) })),
    ...(p.annotations ?? []).map((a) => ({ x: a.x, y: a.y, width: a.width, height: a.height })),
    ...p.groups.map((g) => ({ x: g.x, y: g.y, width: g.width, height: g.height })),
  ];
  /**
   * What a copy stays off: cards, notes and shapes (not boundaries, zones or text, which things may sit
   * on) and the drawn edges. `skip` leaves out the copy itself: its nodes and the edges between them.
   */
  const obstacles = (skip: ReadonlySet<string> = new Set()): PlaceBox[] => {
    const own = new Set(
      skip.size
        ? rf
            .getEdges()
            .filter((e) => skip.has(e.source) && skip.has(e.target))
            .map((e) => e.id)
        : [],
    );
    return [
      ...rf
        .getNodes()
        .filter((n) => !skip.has(n.id) && (isDiagram(n) || (isAnnotation(n) && isObstacle(n.data.kind))))
        .map(box),
      ...(deps().edgeMarks?.() ?? []).filter((m) => !m.edge || !own.has(m.edge)),
    ];
  };
  /**
   * The grid-snapped move that puts `b` clear of `others`, starting from the wanted move `d`: checked
   * after snapping, and past everything when it isn't clear (never on top of anything).
   */
  const snappedClear = (b: PlaceBox, d: XY, others: readonly PlaceBox[]): XY => {
    const snapped = { x: snap10(d.x), y: snap10(d.y) };
    if (isClear({ ...b, x: b.x + snapped.x, y: b.y + snapped.y }, others)) return snapped;
    const past = pastAll(b, others);
    return { x: Math.ceil(past.x / 10) * 10, y: snap10(past.y) };
  };
  /** The flow ids a selection covers: a boundary brings its members along. */
  const flowIdsOf = (sel: Partial<Selection>): Set<string> => {
    const out = new Set(sel.nodeIds ?? []);
    for (const g of sel.groupIds ?? []) {
      out.add(GROUP_PREFIX + g);
      for (const m of members(g)) out.add(m.id);
    }
    return out;
  };
  /** The selection of the copies made of `sel` (`ids`: old flow id → new). */
  const copiedSelection = (sel: Partial<Selection>, ids: Map<string, string>): Selection => ({
    nodeIds: (sel.nodeIds ?? []).map((id) => ids.get(id) ?? id),
    groupIds: (sel.groupIds ?? []).map((g) => ids.get(GROUP_PREFIX + g)?.slice(GROUP_PREFIX.length) ?? g),
    edgeIds: [],
  });

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
    undoTarget: () => deps().history.top(),
    applyDiagram: (next, opts) => {
      const checked = validateDiagram(next);
      if (!checked.ok) throw new Error(checked.error);
      const before = api.getDiagram();
      const diff = diagramDiff(before, checked.diagram);
      if (!diff.hasChanges) return diff;
      lastDuplicate = null;
      flushSync(() => deps().history.replace(toFlow(checked.diagram), opts?.merge, toFlow(before)));
      return diff;
    },
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
      if (ns.filter(isAnnotation).length >= ANNOTATION_LIMITS.maxAnnotations) return null;
      const pointed = opts.at ?? (opts.atPointer ? deps().pointer?.() : undefined);
      // A zone added with things selected marks them: it's drawn around them, with room for its label.
      const wrapped =
        kind === "zone" && opts.aroundSelection !== false
          ? ns.filter((n) => n.selected && !(isAnnotation(n) && n.data.kind === "zone")).map(box)
          : [];
      let at = wrapped.length ? boundaryAround(wrapped) : undefined;
      if (!at) {
        // No spot given (a click in the rail or the palette): the free place nearest the view's centre,
        // so it never lands on a node (notes and shapes would push edges around) or on the last one added.
        const c = pointed ?? placeFree(deps().viewCenter(), size, [...ns.map(box), ...(deps().edgeMarks?.() ?? [])]);
        // Text starts where you pointed (its first line under the cursor); the rest centre on it.
        const x = kind === "text" && pointed ? c.x - 8 : c.x - size.width / 2;
        at = { x: snap10(x), y: snap10(c.y - size.height / 2), ...size };
      }
      const geometryError = annotationGeometryError(at);
      if (geometryError) {
        notify(`Couldn't add ${kind}: ${geometryError}`, { kind: "error" });
        return null;
      }
      const id = uniqueId(annotationIdBase(kind), new Set(ns.map((n) => n.id)));
      const node: AnnotationFlowNode = {
        ...annotationToFlow({
          id,
          kind,
          text: defaultText[kind],
          ...at,
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
          if ("text" in patch) data.text = annotationText(patch.text ?? "");
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
            position: {
              x: annotationCoordinate(patch.x ?? n.position.x),
              y: annotationCoordinate(patch.y ?? n.position.y),
            },
            width: annotationSize(width ?? 1),
            height: annotationSize(height ?? 1),
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
    updateEdge: (id, patch, opts) => api.updateEdges([id], patch, opts),
    updateEdges: (ids, patch, opts) => {
      const targets = new Set(ids);
      hint(opts?.merge);
      deps().setEdges((es) =>
        es.map((e) => {
          if (!targets.has(e.id)) return e;
          const data = { kind: "async" as const, ...e.data };
          if ("label" in patch) data.label = patch.label || undefined;
          if ("kind" in patch) data.kind = patch.kind ?? "async";
          if ("relation" in patch) data.relation = isDependency(patch) ? relationOf(patch) : undefined;
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
      // An edge into a typed stencil (Key Vault, App Configuration, an IdP...) is a dependency, not a flow.
      const stencilOf = (nodeId: string) => {
        const n = rf.getNode(nodeId);
        return n && isDiagram(n) ? n.data.stencil : undefined;
      };
      const relation = inferRelation(stencilOf(from), stencilOf(to));
      deps().setEdges((cur) => [
        ...cur,
        {
          id,
          source: from,
          target: to,
          type: "flow",
          data: relation === "flow" ? { kind: "async" } : { kind: "async", relation },
        },
      ]);
      if (relation !== "flow")
        explainInference(relation, () =>
          api.updateEdge(id, { relation: undefined }, { merge: `inference:flow:${id}` }),
        );
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
      const from = p && boundsOf(payloadBoxes(p));
      if (!p || !from) return;
      const others = obstacles();
      // Ctrl+D on the copy Ctrl+D just made: the same step again, or the gap chosen by moving the copy.
      let offset: XY | null = null;
      const last = lastDuplicate;
      if (last && last.key === selectionKey(sel)) {
        const step = { x: from.x - last.from.x, y: from.y - last.from.y };
        const target = { ...from, x: snap10(from.x + step.x), y: snap10(from.y + step.y) };
        if (isClear(target, others, COPY_MARGIN)) offset = step;
      }
      offset = snappedClear(
        from,
        offset ?? placeCopy(from, others, deps().meta.direction === "TB" ? "TB" : "LR"),
        others,
      );
      const ids = insert(p, offset);
      if (!ids) return;
      const at = { ...from, x: from.x + offset.x, y: from.y + offset.y };
      lastDuplicate = { key: selectionKey(copiedSelection(sel, ids)), from, at };
      deps().reveal?.();
    },
    duplicateInPlace: (sel) => {
      const p = makePayload(diagram(), sel.nodeIds ?? [], sel.groupIds ?? []);
      return (p && insert(p, { x: 0, y: 0 })) ?? new Map<string, string>();
    },
    keepClear: (sel) => {
      const ids = flowIdsOf(sel);
      const b = boundsOf(
        rf
          .getNodes()
          .filter((n) => ids.has(n.id))
          .map(box),
      );
      if (!b) return;
      const others = obstacles(ids);
      const { x: dx, y: dy } = snappedClear(b, clearOffset(b, others), others);
      if (!dx && !dy) return;
      deps().setNodes((cur) =>
        cur.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
      );
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
    keepTextClear: (id, before) => {
      const ns = rf.getNodes();
      const n = ns.find((x) => x.id === id);
      if (!n || !isAnnotation(n) || n.data.kind !== "text") return null;
      // Its own size first: the measure lags a box that just grew.
      const b = {
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? n.measured?.width ?? 0,
        height: n.height ?? n.measured?.height ?? 0,
      };
      if (before && b.x === before.x && b.y === before.y && b.width === before.width && b.height === before.height)
        return null;
      // Cards, notes, shapes and other text; not the backdrops (zones, boundaries) it may sit on.
      const solid = ns
        .filter((o) => o.id !== id && !isGroup(o) && !(isAnnotation(o) && o.data.kind === "zone"))
        .map(box);
      const marks = deps().edgeMarks?.() ?? [];
      // Only what the growth newly covers (or touches): a text placed over something on purpose stays put.
      const near = (r: PlaceBox, o: PlaceBox) =>
        overlaps({ x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 }, o);
      const covers = (list: readonly PlaceBox[]) => list.some((o) => near(b, o) && !(before && near(before, o)));
      const hit = covers(solid) ? "node" : covers(marks) ? "edge" : null;
      if (!hit) return null;
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const to = placeFree(c, b, [...solid, ...marks], { margin: 12, step: 10, maxRings: 40 });
      if (to.x === c.x && to.y === c.y) return null;
      // Its own undo step, after the edit that grew it.
      hint("keep-text-clear");
      const position = { x: Math.round(to.x - b.width / 2), y: Math.round(to.y - b.height / 2) };
      deps().setNodes((cur) => cur.map((o) => (o.id === id ? { ...o, position } : o)));
      return hit;
    },

    copy: (sel) => {
      const p = makePayload(diagram(), sel.nodeIds ?? [], sel.groupIds ?? []);
      if (!p) return;
      clipboard = p;
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
      const from = boundsOf(payloadBoxes(p));
      if (!from || ![from.x, from.y, from.width, from.height].every(Number.isFinite)) return;
      // Paste here (a spot given) puts the top-left there; Ctrl+V centres it on the pointer over the
      // canvas, else on the view's centre. Then it moves clear of what's already there, so a second
      // paste steps to the next free place instead of stacking on the first.
      const c = at ? null : (deps().pointer?.() ?? deps().viewCenter());
      const want = at ?? { x: c!.x - from.width / 2, y: c!.y - from.height / 2 };
      if (!Number.isFinite(want.x) || !Number.isFinite(want.y)) return;
      const placed = { ...from, x: snap10(want.x), y: snap10(want.y) };
      const others = obstacles();
      const d = snappedClear(placed, clearOffset(placed, others), others);
      if (insert(p, { x: placed.x + d.x - from.x, y: placed.y + d.y - from.y })) deps().reveal?.();
    },
    hasClipboard: () => clipboard !== null,

    undo: () => deps().history.undo(),
    redo: () => deps().history.redo(),
    canUndo: () => deps().history.canUndo,
    canRedo: () => deps().history.canRedo,

    fitView: () => deps().fit(),
    zoomTo100: () => void rf.zoomTo(1, { duration: motionMs(250) }),
    zoomToSelection: () => {
      const sel = api.getSelection();
      const ids = flowIdsOf(sel);
      const edges = new Set(sel.edgeIds);
      // The hovered node stands in only when nothing at all is selected.
      const hovered = deps().hovered?.();
      if (!ids.size && !edges.size && hovered) ids.add(hovered);
      if ((!ids.size && !edges.size) || !deps().zoomTo) return false;
      deps().zoomTo!(ids, edges);
      return true;
    },
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
