import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type {
  EdgeChange,
  EdgeMouseHandler,
  NodeChange,
  OnNodeDrag,
  ReactFlowInstance,
  useStoreApi,
} from "@xyflow/react";
import type { EditorApi, EditorPrefs } from "../../editor/types";
import { expandGroupIds } from "../../model/groupHierarchy";
import type { EdgeStyle } from "../../harness/edgeStyles";
import type { NodeVariantId } from "../../harness/nodeVariants";
import { notify } from "../../interop/ui/toast";
import { t as tr } from "../../i18n";
import type { RenameTarget } from "../DiagramContext";
import type { DiagramMeta } from "../convert";
import type { MenuState } from "../CanvasView";
import {
  GROUP_PREFIX,
  isAnnotationNode,
  isDiagramNode,
  isGroupNode,
  type AnnotationFlowNode,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type FlowNode,
} from "../types";
import { useSmartGuides } from "../useSmartGuides";
import { edgeHover, nearestEdge, type EdgeHover } from "../edgeHover";
import { selectRoutes } from "../edges/useEdgeRoute";
import { dependencyVisibility } from "../dependencyVisibility";
import { insertLine } from "../landing";
import { memberBoxes } from "../memberBoxes";
import { previewMembership, type GroupRect, type MemberBox } from "../membership";

export function useDragPlacement({
  store,
  prefs,
  editGestures,
  onNodesChange,
  onEdgesChange,
  beginGesture,
  endGesture,
  rename,
  edgeStyle,
  meta,
  nodeVariant,
  screenToFlowPosition,
  wrapper,
  editor,
  dragStarted,
  hideTip,
  setMenu,
}: {
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  prefs: EditorPrefs;
  editGestures: boolean;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<DiagramFlowEdge>[]) => void;
  beginGesture: () => void;
  endGesture: () => void;
  rename: RefObject<(t: RenameTarget) => void>;
  edgeStyle: EdgeStyle;
  meta: DiagramMeta;
  nodeVariant: NodeVariantId;
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"];
  wrapper: RefObject<HTMLDivElement | null>;
  editor: EditorApi;
  dragStarted: () => void;
  hideTip: () => void;
  setMenu: Dispatch<SetStateAction<MenuState | null>>;
}) {
  // ---------------------------------------------------------------- Alt-drag duplicates (D9), smart guides (D6)
  /** While an Alt-drag runs: original flow id → its copy. The drag moves the copies; the originals stay. */
  const altCopies = useRef<Map<string, string> | null>(null);
  /** The guides' overlay: one layer over the flow, drawn only during a drag. */
  const guideLayer = useRef<SVGSVGElement>(null);
  const guides = useSmartGuides({
    store,
    snap: prefs.snap,
    guides: editGestures,
    layer: guideLayer,
    apply: onNodesChange,
  });
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (changes.some((c) => c.type === "dimensions" && c.resizing)) beginGesture();
      if (changes.some((c) => c.type === "dimensions" && c.resizing === false)) {
        // Boundary adoption also runs in this frame; close only after both have rendered.
        requestAnimationFrame(endGesture);
      }
      let next = changes;
      if (store.getState().userSelectionActive) next = next.filter((c) => c.type !== "select");
      const copies = altCopies.current;
      if (copies)
        next = next.map((c) => (c.type === "position" && copies.has(c.id) ? { ...c, id: copies.get(c.id)! } : c));
      // While dragging: snapped to guides, equal gaps or the grid, with boundary members following.
      next = guides.filter(next);
      if (next.length) onNodesChange(next);
    },
    [store, onNodesChange, guides, beginGesture, endGesture],
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<DiagramFlowEdge>[]) => {
      const next = store.getState().userSelectionActive ? changes.filter((c) => c.type !== "select") : changes;
      if (next.length) onEdgesChange(next);
    },
    [store, onEdgesChange],
  );

  const onEdgeDoubleClick: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (_e, edge) => rename.current({ kind: "edge", id: edge.id }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rename is a stable ref; preserve CanvasView's original dependencies
    [],
  );

  // One lifecycle for every drag: a node, a selection (by a node or by its frame) and an Alt-drag. React
  // Flow calls onNodeDragStart / onNodeDragStop for all of them, the selection frame included (it calls
  // onSelectionDragStart as well, which is why that one isn't registered). `dragActive` makes a second
  // start or stop for the same gesture a no-op, so copies are made exactly once.
  const dragActive = useRef(false);
  /**
   * Insert on drop (D8): a single node with no edges, held over an edge for a moment, lights the edge up;
   * dropped there (without Ctrl/Cmd) it goes in between: A→B becomes A→N→B, in the drag's undo step.
   */
  const insertWatch = useRef<{ node: string; hover: EdgeHover; stop: () => void } | null>(null);
  /** Edge hover for an insert, against the routes as drawn now (edges step aside from a node over them). */
  const insertHover = useCallback(() => {
    const s = store.getState();
    const routes = selectRoutes(s, {
      style: edgeStyle,
      direction: meta.direction ?? "LR",
      captions: nodeVariant === "iconOnly",
      hideDependencies: !dependencyVisibility.get(),
    });
    const lines = [...routes].map(([id, r]) => ({ id, points: r.points }));
    return edgeHover(
      // Within 10 px on screen of the line.
      (x, y) => nearestEdge(lines, screenToFlowPosition({ x, y }), 10 / store.getState().transform[2]),
      (id) => wrapper.current?.querySelector(`[data-testid="edge-${CSS.escape(id)}"]`) ?? null,
      undefined,
      // The line it will split, where it ran before the node came over it.
      (id) => insertLine.set(lines.find((l) => l.id === id)?.points ?? null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is a stable ref; preserve CanvasView's original dependencies
  }, [store, edgeStyle, meta.direction, nodeVariant, screenToFlowPosition]);
  const watchInsert = useCallback(
    (nodeId: string) => {
      const hover = insertHover();
      const onMove = (e: PointerEvent) => hover.at(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
      document.addEventListener("pointermove", onMove, true);
      insertWatch.current = {
        node: nodeId,
        hover,
        stop: () => {
          document.removeEventListener("pointermove", onMove, true);
          hover.clear();
        },
      };
    },
    [insertHover],
  );
  useEffect(() => () => insertWatch.current?.stop(), []);
  /**
   * Boundaries that keep up (D12): while nodes are dragged, the boundary that will hold them on drop shows its
   * outline in its tone (`data-membership` "join" or "hold"), and one they'd leave shows dashed ("leave"), as
   * does one that can't grow to hold a member poking out ("blocked"). The node's centre decides. Painted on
   * the boundaries' elements once a frame, so a drag re-renders nothing.
   */
  const membershipWatch = useRef<{ stop: () => void } | null>(null);
  /**
   * The dragged nodes whose membership a drop decides (their copies' ids, for an Alt-drag): all of them but the
   * members of a boundary dragged with them, which it carries.
   */
  const droppedNodes = useCallback(
    (dragged: FlowNode[], copies: Map<string, string> | null) => {
      const carriers = expandGroupIds(
        dragged.filter(isGroupNode).map((g) => g.data.groupId),
        store
          .getState()
          .nodes.filter(isGroupNode)
          .map((g) => ({ id: g.data.groupId, group: g.data.group })),
      );
      const carried = (n: FlowNode) => {
        // An Alt-drag's copy belongs to the copy of its boundary, the original's to the original.
        const g = n.data.group;
        return !!g && carriers.has(g);
      };
      return dragged
        .filter(
          (n): n is DiagramFlowNode | AnnotationFlowNode => (isDiagramNode(n) || isAnnotationNode(n)) && !carried(n),
        )
        .map((n) => copies?.get(n.id) ?? n.id);
    },
    [store],
  );
  const watchMembership = useCallback(
    (dragged: FlowNode[], copies: Map<string, string> | null) => {
      const s = store.getState();
      const ids = droppedNodes(dragged, copies);
      const groupsOf = (ns: readonly FlowNode[]): GroupRect[] =>
        ns.filter(isGroupNode).map((g) => ({
          id: g.data.groupId,
          x: g.position.x,
          y: g.position.y,
          width: g.width ?? g.measured?.width ?? 0,
          height: g.height ?? g.measured?.height ?? 0,
        }));
      const moving = new Set([...ids, ...dragged.map((n) => n.id)]);
      const othersOf = (ns: readonly FlowNode[]): MemberBox[] => memberBoxes(ns.filter((n) => !moving.has(n.id)));
      // Boundaries dragged along (with their members) move under the nodes: read them each frame then. Otherwise
      // the rest holds still, so it's read once.
      const live = dragged.some(isGroupNode);
      let groups = groupsOf(s.nodes);
      let others = othersOf(s.nodes);
      if (!ids.length || !groups.length) return;
      const marked = new Map<string, Element>();
      let frame = 0;
      const paint = () => {
        frame = 0;
        const st = store.getState();
        if (live) {
          groups = groupsOf(st.nodes);
          others = othersOf(st.nodes);
        }
        const now: MemberBox[] = [];
        for (const id of ids) {
          const n = st.nodeLookup.get(id);
          const u = n?.internals.userNode;
          if (!n || !u) continue;
          now.push(...memberBoxes([{ ...u, position: n.internals.positionAbsolute }]));
        }
        const preview = previewMembership(now, groups, others);
        for (const [id, el] of marked)
          if (!preview.has(id)) {
            el.removeAttribute("data-membership");
            marked.delete(id);
          }
        for (const [id, m] of preview) {
          const el =
            marked.get(id) ?? wrapper.current?.querySelector(`[data-testid="group-${CSS.escape(id)}"]`) ?? null;
          if (!el) continue;
          marked.set(id, el);
          if (el.getAttribute("data-membership") !== m) el.setAttribute("data-membership", m);
        }
      };
      const onMove = () => {
        if (!frame) frame = requestAnimationFrame(paint);
      };
      document.addEventListener("pointermove", onMove, true);
      membershipWatch.current = {
        stop: () => {
          document.removeEventListener("pointermove", onMove, true);
          cancelAnimationFrame(frame);
          for (const el of marked.values()) el.removeAttribute("data-membership");
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is a stable ref; preserve CanvasView's original dependencies
    [store, droppedNodes],
  );
  useEffect(() => () => membershipWatch.current?.stop(), []);
  /** Members dropped outside their boundary left it: say so, with Undo (D12: leaving is never silent). */
  const sayLeft = useCallback(
    (left: Map<string, string[]>) => {
      const [first] = left;
      if (!first) return;
      const [groupId, ids] = first;
      const count = [...left.values()].reduce((n, l) => n + l.length, 0);
      const group = editor.getGroup(groupId)?.label || tr("chrome.itsBoundary");
      const one = count === 1 ? editor.getNode(ids[0])?.label || ids[0] : null;
      const where = left.size > 1 ? tr("chrome.theirBoundaries") : group;
      notify(
        one
          ? tr("chrome.valueLeftValue", { name: one, boundary: where })
          : tr("chrome.valueNodesLeftValueOtherValueNodesLeftValue", { count, boundary: where }),
        {
          action: {
            get label() {
              return tr("ai.undo");
            },
            run: editor.undo,
            testId: "membership-undo",
            undoes: true,
          },
        },
      );
    },
    [editor],
  );
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (e, _node, dragged) => {
      if (dragActive.current) return;
      beginGesture();
      dragActive.current = true;
      dragStarted();
      setMenu(null);
      hideTip();
      const only = dragged.length === 1 ? dragged[0] : undefined;
      if (editGestures && !e.altKey && only?.type === "diagram") {
        const linked = store.getState().edges.some((x) => x.source === only.id || x.target === only.id);
        if (!linked) watchInsert(only.id);
      }
      // Alt-drag: copies take the originals' place and move with the pointer; the originals stay.
      if (editGestures && e.altKey) {
        const made = editor.duplicateInPlace({
          nodeIds: dragged.filter((n) => n.type !== "boundary").map((n) => n.id),
          groupIds: dragged.filter(isGroupNode).map((n) => n.data.groupId),
        });
        if (made.size) altCopies.current = made;
      }
      guides.start(e, dragged, altCopies.current);
      if (editGestures) watchMembership(dragged, altCopies.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMenu is stable; preserve CanvasView's original dependencies
    [hideTip, editGestures, editor, guides, store, watchInsert, watchMembership, dragStarted, beginGesture],
  );
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (e, _node, dragged) => {
      if (!dragActive.current) return;
      dragActive.current = false;
      guides.stop();
      const watch = insertWatch.current;
      insertWatch.current = null;
      const into = watch?.hover.lit();
      watch?.stop();
      if (watch && into && !(e.ctrlKey || e.metaKey)) editor.insertIntoEdge(into, watch.node);
      membershipWatch.current?.stop();
      membershipWatch.current = null;
      const copies = altCopies.current;
      altCopies.current = null;
      // Members a dragged boundary carries stay in it; every other dropped node settles where it landed.
      const draggedGroups = dragged.filter(isGroupNode);
      const ids = droppedNodes(dragged, copies);
      // Once the drop has rendered: a copy dropped onto something moves to the nearest free place (nothing
      // overlaps by default), then the dropped nodes settle into the boundaries around them, which grow to hold
      // a member poking out (D12), in the drop's undo step. A member that left its boundary says so.
      requestAnimationFrame(() => {
        endGesture();
        if (copies) {
          const made = [...copies.values()];
          editor.keepClear({
            nodeIds: made.filter((id) => !id.startsWith(GROUP_PREFIX)),
            groupIds: made.filter((id) => id.startsWith(GROUP_PREFIX)).map((id) => id.slice(GROUP_PREFIX.length)),
          });
        }
        if (!ids.length && !draggedGroups.length) return;
        if (ids.length) {
          const left = editor.settleMembership(ids);
          if (!copies && editGestures) sayLeft(left);
        }
        if (draggedGroups.length) {
          const targetFlowIds = draggedGroups.map((g) => copies?.get(g.id) ?? g.id);
          editor.settleBoundaryMembership(targetFlowIds.map((id) => id.slice(GROUP_PREFIX.length)));
        }
      });
    },
    [editor, guides, editGestures, sayLeft, droppedNodes, endGesture],
  );
  return {
    guideLayer,
    handleNodesChange,
    handleEdgesChange,
    onEdgeDoubleClick,
    onNodeDragStart,
    onNodeDragStop,
    insertHover,
  };
}
