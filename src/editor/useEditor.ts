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
  placeToward,
  FLOW_GAP,
  isDownstream,
  towardOf,
  type Toward,
  type Box as PlaceBox,
} from "../canvas/placement";
import { reconnectEdge, splitFlowEdge } from "./edgeEdits";
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
import { motionMs } from "../lib/motion";
import { align, boundaryAround, distribute, spreadOverlaps, type Box, type Positions } from "./arrange";
import { makePayload, parsePayload, remapPayload, type ClipboardPayload } from "./clipboard";
import { stencilIdBase, uniqueId } from "./ids";
import { layeredLayout } from "./layout";
import type { HistoryApi } from "./useHistory";
import type { EditorApi, EditorPrefs, NewNode, Selection, XY } from "./types";
import { diagramDiff } from "./diagramDiff";
import { nudgeOnGrid } from "../canvas/guides";
import { validateDiagram } from "../interop/native";
import type { DiagramAnnotation } from "../model/types";
import {
  membershipAfterResize,
  planKeep,
  settleMembership,
  type GroupRect,
  type MemberBox,
} from "../canvas/membership";
import { tidyLayout } from "./tidy";
import { choiceOf } from "./relationActions";
import { dependencyVisibility } from "../canvas/dependencyVisibility";

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
  /** Makes a node, brings it into view and opens its name, keeping keys typed meanwhile (the canvas). */
  nameNew?: (make: () => NewNode | null, fallback: string) => void;
  /** This diagram is private (local-only or the Private switch): copies from it say so. */
  isPrivate?: () => boolean;
  /**
   * A paste from a private diagram is about to land: make this diagram private first. False when it can't
   * be (an example, a shared diagram): then nothing is pasted.
   */
  makePrivate?: () => boolean;
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
/** Nodes and shapes take edges; texts, notes, zones and boundaries don't. */
const takesEdges = (n: FlowNode) => isDiagram(n) || (isAnnotation(n) && isConnectable(n.data.kind));
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
   * Opens the creation transaction of a node about to be added (`new:<id>`): the node, its edge and the name
   * typed in its editor are one undo step, however long the naming takes (useHistory's `begin`).
   */
  const beginCreation = (merge: string) => {
    const h = deps().history;
    if (h.begin) h.begin(merge);
    else h.hint(merge);
  };
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
    // A copy landing in a boundary already there joins it, and the boundary grows to hold it (D12).
    const joining = new Set(nodes.filter((n) => !(n.data.group && newGroups.has(n.data.group))).map((n) => n.id));
    deps().setNodes(
      (cur) =>
        settled(
          [
            ...notes.filter((n) => n.data.kind === "zone"),
            ...cur.map((n) => (n.selected ? { ...n, selected: false } : n)),
            ...groupNodes,
            ...foregroundLayerOrder(r).map((id) => foreground.get(id)!),
          ],
          joining,
        ).nodes,
    );
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
  /** Ids in use: nodes, notes, boundaries and connections share one id space (validateDiagram). */
  const takenIds = () =>
    new Set([...rf.getNodes().map((n) => (isGroup(n) ? n.data.groupId : n.id)), ...rf.getEdges().map((e) => e.id)]);
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

  /** Boundaries as rects (their own size first: a resize sets it before React Flow measures it). */
  const groupRects = (ns: readonly FlowNode[]): GroupRect[] =>
    ns.filter(isGroup).map((n) => ({
      id: n.data.groupId,
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? n.measured?.width ?? 0,
      height: n.height ?? n.measured?.height ?? 0,
    }));
  const memberBoxes = (ns: readonly FlowNode[]): MemberBox[] =>
    ns.filter(isDiagram).map((n) => ({ ...box(n), group: n.data.group }));
  /**
   * Nodes `ids` (at their new places) settled into boundaries (D12): each one in the boundary around its
   * centre, and that boundary grown to hold it when it pokes out (never onto another boundary or a node that
   * isn't a member). Returns the nodes as they should be, and the members each boundary lost.
   */
  const settled = (ns: FlowNode[], ids: ReadonlySet<string>) => {
    const all = memberBoxes(ns);
    const moving = all.filter((m) => ids.has(m.id));
    if (!moving.length) return { nodes: ns, left: new Map<string, string[]>() };
    const s = settleMembership(
      moving,
      groupRects(ns),
      all.filter((m) => !ids.has(m.id)),
    );
    let changed = false;
    const nodes = ns.map((n): FlowNode => {
      if (isDiagram(n) && s.group.has(n.id)) {
        const group = s.group.get(n.id);
        if (group === n.data.group) return n;
        changed = true;
        return { ...n, data: { ...n.data, group } };
      }
      const r = isGroup(n) ? s.grow.get(n.data.groupId) : undefined;
      if (!r) return n;
      changed = true;
      return { ...n, position: { x: r.x, y: r.y }, width: r.width, height: r.height };
    });
    return { nodes: changed ? nodes : ns, left: s.left };
  };
  /** Adds `node` (selected, the rest deselected), settled into the boundary around it (grown to hold it). */
  const addSettled = (node: FlowNode) =>
    deps().setNodes(
      (cur) =>
        settled([...cur.map((n) => (n.selected ? { ...n, selected: false } : n)), node], new Set([node.id])).nodes,
    );
  /** One function for every annotation patch (one or many). */
  const patchAnnotation = (
    n: AnnotationFlowNode,
    patch: Partial<Omit<DiagramAnnotation, "id">>,
  ): AnnotationFlowNode => {
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
  };

  const readSystemClipboard = async (): Promise<ClipboardPayload | null> => {
    try {
      const text = await navigator.clipboard?.readText();
      return text ? parsePayload(text) : null;
    } catch {
      return null;
    }
  };

  /**
   * Where a node `size` goes beside `from` on `toward` side (default: downstream): one gap that way, stepping
   * across past what's there, then (a crowded side) the nearest free place on the grid. Never on anything.
   */
  const spotBeside = (from: PlaceBox, toward: Toward | undefined, size: { width: number; height: number }) => {
    const others = obstacles();
    const dir = toward ?? towardOf(deps().meta.direction === "TB" ? "TB" : "LR");
    const c = placeToward(from, size, others, dir, COPY_MARGIN, FLOW_GAP);
    const at = { x: snap10(c.x - size.width / 2), y: snap10(c.y - size.height / 2), ...size };
    const d = snappedClear(at, clearOffset(at, others), others);
    return { ...at, x: at.x + d.x, y: at.y + d.y };
  };
  /**
   * A new edge from `a` to `b`, its relationship inferred from their stencils (an edge into Key Vault is a
   * secret dependency, one from a deploy pipeline a deploy). The stencils are passed in, so a node not yet
   * committed to React Flow's store infers the same as one that is.
   */
  const newEdge = (
    a: { id: string; stencil?: string },
    b: { id: string; stencil?: string },
    existing: readonly DiagramFlowEdge[],
  ): DiagramFlowEdge => {
    const relation = inferRelation(a.stencil, b.stencil);
    return {
      // Its ends too: a node not yet in React Flow's store is in no other list.
      id: uniqueId("e", new Set([...takenIds(), a.id, b.id, ...existing.map((e) => e.id)])),
      source: a.id,
      target: b.id,
      type: "flow",
      data: relation === "flow" ? { kind: "async" } : { kind: "async", relation },
    };
  };
  /** The first time a relationship is inferred, a toast says what it means (with a way back to a flow). */
  const explainEdge = (edge: DiagramFlowEdge) => {
    const relation = edge.data?.relation;
    if (relation && isDependency(edge.data))
      explainInference(relation as DependencyRelation, () =>
        api.updateEdge(edge.id, { relation: undefined }, { merge: `inference:flow:${edge.id}` }),
      );
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
    selectSimilar: ({ nodeId, edgeId }) => {
      if (nodeId) {
        const n = rf.getNode(nodeId);
        if (!n || !isDiagram(n)) return 0;
        const nodeIds = rf
          .getNodes()
          .filter((x) => isDiagram(x) && x.data.stencil === n.data.stencil)
          .map((x) => x.id);
        setSelected({ nodeIds });
        return nodeIds.length;
      }
      const e = edgeId ? rf.getEdge(edgeId) : undefined;
      if (!e) return 0;
      const want = choiceOf(e.data);
      // Hidden dependencies can't be seen or picked, so they aren't "similar" either.
      const shown = dependencyVisibility.get();
      const edgeIds = rf
        .getEdges()
        .filter((x) => choiceOf(x.data) === want && (shown || !isDependency(x.data)))
        .map((x) => x.id);
      setSelected({ edgeIds });
      return edgeIds.length;
    },

    addNamed: (stencilId, at) => {
      const id = api.addNode(stencilId, at);
      return { id, edge: null, merge: `new:${id}` };
    },

    addNode: (stencilId, at) => {
      const s = getStencil(stencilId);
      const { width, height } = deps().nodeSize;
      const ns = rf.getNodes();
      // No spot given (a click in the rail or the palette): the free place nearest the view's centre.
      const c =
        at ?? placeFree(deps().viewCenter(), { width, height }, [...ns.map(box), ...(deps().edgeMarks?.() ?? [])]);
      const id = uniqueId(stencilIdBase(s.id), takenIds());
      // Its name, typed in the editor that may open next (quick-add, or Enter on it), joins the step that made it.
      beginCreation(`new:${id}`);
      const node: DiagramFlowNode = {
        id,
        type: "diagram",
        position: { x: snap10(c.x - width / 2), y: snap10(c.y - height / 2) },
        selected: true,
        data: { stencil: s.id, label: s.label, sublabel: s.defaultSublabel, group: groupAt(ns, c.x, c.y) },
      };
      addSettled(node);
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
      const id = uniqueId(annotationIdBase(kind), takenIds());
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
      deps().setNodes((ns) => ns.map((n) => (n.id === id && isAnnotation(n) ? patchAnnotation(n, patch) : n)));
      // A shape that stops being a shape can't keep its edges.
      if (patch.kind && !isConnectable(patch.kind))
        deps().setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    },

    updateAnnotations: (ids, patch, opts) => {
      const set = new Set(ids);
      hint(opts?.merge);
      deps().setNodes((ns) => ns.map((n) => (set.has(n.id) && isAnnotation(n) ? patchAnnotation(n, patch) : n)));
    },
    updateNodes: (ids, patch, opts) => {
      const set = new Set(ids);
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) => {
          if (!set.has(n.id) || !isDiagram(n)) return n;
          const data = { ...n.data };
          if (patch.stencil) data.stencil = patch.stencil;
          if ("group" in patch) data.group = patch.group || undefined;
          return data.stencil === n.data.stencil && data.group === n.data.group ? n : { ...n, data };
        }),
      );
    },
    setNodesProps: (ids, patch, opts) => {
      const set = new Set(ids);
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) =>
          set.has(n.id) && isDiagram(n)
            ? { ...n, data: { ...n.data, props: withoutUndefined({ ...n.data.props, ...patch }) } }
            : n,
        ),
      );
    },
    updateGroups: (ids, patch, opts) => {
      const set = new Set(ids);
      hint(opts?.merge);
      deps().setNodes((ns) =>
        ns.map((n) =>
          isGroup(n) && set.has(n.data.groupId) && patch.tone && n.data.tone !== patch.tone
            ? { ...n, data: { ...n.data, tone: patch.tone } }
            : n,
        ),
      );
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
      const stencilOf = (nodeId: string) => {
        const n = rf.getNode(nodeId);
        return n && isDiagram(n) ? n.data.stencil : undefined;
      };
      const edge = newEdge({ id: from, stencil: stencilOf(from) }, { id: to, stencil: stencilOf(to) }, es);
      deps().setEdges((cur) => [...cur, edge]);
      explainEdge(edge);
      return edge.id;
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
    nextSpot: (fromId, toward, clone = false) => {
      const n = rf.getNode(fromId);
      if (!n || !takesEdges(n)) return null;
      const from = box(n);
      return spotBeside(from, toward, clone ? { width: from.width, height: from.height } : deps().nodeSize);
    },
    createConnected: (req) => {
      const ns = rf.getNodes();
      const src = ns.find((n) => n.id === req.from);
      if (!src || !takesEdges(src)) return null;
      const srcStencil = isDiagram(src) ? src.data.stencil : undefined;
      let data: DiagramFlowNode["data"];
      let size = deps().nodeSize;
      if (req.clone) {
        if (!isDiagram(src)) return null;
        const b = box(src);
        size = { width: b.width, height: b.height };
        data = { ...src.data, props: src.data.props && structuredClone(src.data.props) };
      } else {
        const s = getStencil(req.stencil ?? "");
        data = { stencil: s.id, label: s.label, sublabel: s.defaultSublabel };
      }
      // Where: the drop point (a dropped connection, centred on it), else one gap beside the node that way.
      const toward = req.toward ?? towardOf(deps().meta.direction === "TB" ? "TB" : "LR");
      const spot = req.at
        ? { x: req.at.x - size.width / 2, y: req.at.y - size.height / 2 }
        : spotBeside(box(src), toward, size);
      const position = { x: snap10(spot.x), y: snap10(spot.y) };
      const id = uniqueId(stencilIdBase(data.stencil), takenIds());
      const node: DiagramFlowNode = {
        id,
        type: "diagram",
        position,
        selected: true,
        data: { ...data, group: groupAt(ns, position.x + size.width / 2, position.y + size.height / 2) },
      };
      // The edge from what's known here (both stencils), not from React Flow's store, which won't have the
      // new node until React commits: an edge into a new Key Vault is a secret dependency at once.
      const ends = [
        { id: src.id, stencil: srcStencil },
        { id, stencil: data.stencil },
      ];
      const [a, b] = req.at || isDownstream(toward) ? ends : [ends[1], ends[0]];
      const edge = newEdge(a, b, rf.getEdges());
      const merge = `new:${id}`;
      beginCreation(merge);
      addSettled(node);
      deps().setEdges((cur) => [...cur.map((e) => (e.selected ? { ...e, selected: false } : e)), edge]);
      explainEdge(edge);
      return { id, edge: edge.id, merge };
    },
    insertNode: (edgeId, stencilId, at) => {
      const es = rf.getEdges();
      const e = es.find((x) => x.id === edgeId);
      const a = e && rf.getNode(e.source);
      const b = e && rf.getNode(e.target);
      if (!e || !a || !b) return null;
      const s = getStencil(stencilId);
      const size = deps().nodeSize;
      const ns = rf.getNodes();
      // Where it was dropped; from a menu, the free place nearest the middle of the two ends (the edge itself
      // doesn't count: it's about to go through the node).
      const [ba, bb] = [box(a), box(b)];
      const mid = {
        x: (ba.x + ba.width / 2 + bb.x + bb.width / 2) / 2,
        y: (ba.y + ba.height / 2 + bb.y + bb.height / 2) / 2,
      };
      const others = obstacles().filter((o) => (o as { edge?: string }).edge !== edgeId);
      const c = at ?? placeFree(mid, size, others, { margin: COPY_MARGIN, step: 20, maxRings: 40 });
      const id = uniqueId(stencilIdBase(s.id), takenIds());
      const node: DiagramFlowNode = {
        id,
        type: "diagram",
        position: { x: snap10(c.x - size.width / 2), y: snap10(c.y - size.height / 2) },
        selected: true,
        data: { stencil: s.id, label: s.label, sublabel: s.defaultSublabel, group: groupAt(ns, c.x, c.y) },
      };
      const r = splitFlowEdge(es, edgeId, id, takenIds().add(id));
      if (!r) return null;
      const merge = `new:${id}`;
      beginCreation(merge);
      addSettled(node);
      deps().setEdges(r.edges.map((x) => (x.selected ? { ...x, selected: false } : x)));
      return { id, edge: null, merge };
    },
    nameNew: (make, fallback) => {
      const name = deps().nameNew;
      if (name) name(make, fallback);
      else make();
    },
    stencilAnchor: () => {
      const sel = api.getSelection();
      if (sel.nodeIds.length !== 1 || sel.edgeIds.length || sel.groupIds.length) return undefined;
      const n = rf.getNode(sel.nodeIds[0]);
      return n && takesEdges(n) ? n.id : undefined;
    },
    addStencil: (stencilId) => {
      const from = api.stencilAnchor();
      const made = from ? api.createConnected({ from, stencil: stencilId }) : null;
      const id = made?.id ?? api.addNode(stencilId);
      deps().reveal?.();
      return id;
    },
    reconnectEdge: (edgeId, end, nodeId) => {
      const target = rf.getNode(nodeId);
      if (!target || !takesEdges(target)) return false;
      const next = reconnectEdge(rf.getEdges(), edgeId, end, nodeId);
      if (!next) return false;
      deps().setEdges(next);
      return true;
    },
    insertIntoEdge: (edgeId, nodeId) => {
      const n = rf.getNode(nodeId);
      if (!n || !takesEdges(n)) return false;
      const r = splitFlowEdge(rf.getEdges(), edgeId, nodeId, takenIds());
      if (!r) return false;
      deps().setEdges(r.edges);
      return true;
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
      const boxes = rf
        .getNodes()
        .filter((n) => set.has(n.id) && isPlaced(n))
        .map(box);
      // Lined up, never stacked: things that would land on each other step apart across the line.
      const across = mode === "left" || mode === "center" || mode === "right" ? "v" : "h";
      movePositions(spreadOverlaps(boxes, align(boxes, mode), across));
    },
    distribute: (ids, axis) => {
      const set = new Set(ids);
      const boxes = rf
        .getNodes()
        .filter((n) => set.has(n.id) && isPlaced(n))
        .map(box);
      movePositions(spreadOverlaps(boxes, distribute(boxes, axis), axis));
    },
    tidy: (ids) => {
      const set = new Set(ids);
      const ns = rf.getNodes();
      const picked = ns.filter((n): n is DiagramFlowNode => set.has(n.id) && isDiagram(n));
      if (picked.length < 2) return false;
      // Only the nodes move: anything else selected (a note, a shape) stays put, so it's an obstacle too.
      const moving = new Set(picked.map((n) => n.id));
      const groups = groupRects(ns);
      const members = memberBoxes(ns);
      const stay = members.filter((m) => !moving.has(m.id));
      const own = new Map(members.map((m) => [m.id, m.group]));
      /** The boundaries' growth that keeps every tidied node in its own boundary there, or null. */
      const fit = (pos: Positions) =>
        planKeep(
          picked.map((n) => ({ ...box(n), ...pos.get(n.id)!, group: own.get(n.id) })),
          groups,
          stay,
        );
      const pos = tidyLayout({
        nodes: picked.map((n) => ({ ...box(n), label: n.data.label })),
        edges: rf.getEdges().map((e) => ({ from: e.source, to: e.target, label: e.data?.label })),
        direction: deps().meta.direction === "TB" ? "TB" : "LR",
        // Everything else stays put, so the tidied nodes land clear of it (boundaries and zones are backdrops).
        others: ns
          .filter((n) => !moving.has(n.id) && (isDiagram(n) || (isAnnotation(n) && isObstacle(n.data.kind))))
          .map(box),
        // Members stay in their boundaries, which must be able to grow to hold them there.
        accept: (p) => fit(p) !== null,
      });
      const grow = pos && fit(pos);
      if (!pos || !grow) {
        notify("Couldn't find room. Nothing moved.");
        return false;
      }
      // The positions and the boundaries' growth together, as planned: one undo step.
      hint(`tidy:${Date.now()}`);
      deps().setNodes((cur) =>
        cur.map((n) => {
          if (isGroup(n)) {
            const r = grow.get(n.data.groupId);
            return r ? { ...n, position: { x: r.x, y: r.y }, width: r.width, height: r.height } : n;
          }
          const at = pos.get(n.id);
          return at && (at.x !== n.position.x || at.y !== n.position.y) ? { ...n, position: at } : n;
        }),
      );
      return true;
    },
    settleMembership: (ids) => {
      const set = new Set(ids);
      const { left } = settled(rf.getNodes(), set);
      deps().setNodes((cur) => settled(cur, set).nodes);
      return left;
    },
    adoptAfterResize: (groupId) => {
      const ns = rf.getNodes();
      const r = membershipAfterResize(groupId, memberBoxes(ns), groupRects(ns));
      if (!r.group.size) return { adopted: [], released: [] };
      deps().setNodes((cur) =>
        cur.map((n) =>
          isDiagram(n) && r.group.has(n.id) ? { ...n, data: { ...n.data, group: r.group.get(n.id) } } : n,
        ),
      );
      return { adopted: r.adopted, released: r.released };
    },
    groupNodes: (ids, tone = "neutral") => {
      const set = new Set(ids);
      const nodes = rf.getNodes().filter((n) => set.has(n.id) && isDiagram(n));
      if (!nodes.length) return null;
      const id = uniqueId("boundary", takenIds());
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
    nudge: (dx, dy, far) => {
      if (!deps().prefs.snap) return api.moveSelection(dx * (far ? 10 : 1), dy * (far ? 10 : 1));
      const sel = rf.getNodes().filter((n) => n.selected);
      if (!sel.length) return;
      const x = Math.min(...sel.map((n) => n.position.x));
      const y = Math.min(...sel.map((n) => n.position.y));
      const step = far ? 50 : null;
      api.moveSelection(nudgeOnGrid(x, dx, 10, step), nudgeOnGrid(y, dy, 10, step));
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
      const p = makePayload(diagram(), sel.nodeIds ?? [], sel.groupIds ?? [], api.isPrivate?.());
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
      // Private content keeps its privacy: the diagram it lands in becomes private, or it doesn't land.
      if (p.private && !api.isPrivate?.() && deps().makePrivate?.() === false) return;
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
    isPrivate: () => deps().isPrivate?.() ?? false,

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
    // An editor opened on a node still in its creation transaction (a rail or Ctrl+K "Add", then Enter) names it
    // inside that step.
    startEditing: (target) => {
      const open = deps().history.open?.();
      const joins = target.kind === "node" && !target.merge && open === `new:${target.id}`;
      deps().setEditing(joins ? { ...target, merge: open } : target);
    },
    openInspector: (field) => deps().openInspector(field),
    showShortcuts: () => deps().showShortcuts(),
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
