import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ReactFlowState, useStoreApi } from "@xyflow/react";
import { isDependency } from "../../model/relations";
import { dependencyVisibility } from "../dependencyVisibility";
import { edgesBetween, pickInBox, type BoxItem } from "../gestures";
import type { AnnotationFlowNode, DiagramFlowEdge, FlowNode } from "../types";

/** Ids whose selected flag inside React Flow disagrees with the box's pick. */
function staleBoxFlags(
  s: Pick<ReactFlowState<FlowNode, DiagramFlowEdge>, "nodeLookup">,
  picked: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const n of s.nodeLookup.values()) if (!!n.selected !== picked.has(n.id)) out.add(n.id);
  return out;
}

export function useBoxSelection({
  editGestures,
  store,
  setNodes,
  setEdges,
}: {
  editGestures: boolean;
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<DiagramFlowEdge[]>>;
}) {
  // ---------------------------------------------------------------- selection box (D5)
  // React Flow's own box picks only whole nodes and every edge they touch. Ours picks what it touches
  // (Ctrl/Cmd held: only what's wholly inside), boundaries and zones only when wholly inside, and the
  // edges whose both ends it picked. React Flow's selection changes are dropped while a box is drawn.
  const contain = useRef(false);
  /** Shift held as the box started: what was selected then stays selected (Shift adds, as Shift+click does). */
  const boxBase = useRef<{ nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null>(null);
  const boxPicked = useRef<string | null>(null);
  const boxSet = useRef<Set<string> | null>(null);
  /**
   * Sets the box's pick on the app's nodes. React Flow's own box code flips the selected flag on its
   * internal copies before emitting the changes we drop, and keeps an internal copy as long as the app's
   * node object is the same. `stale` (ids whose internal flag disagrees) get a fresh object, so React
   * Flow re-reads them from the app's state and both agree.
   */
  const applyBoxPick = useCallback(
    (set: ReadonlySet<string>, stale: ReadonlySet<string>) =>
      setNodes((ns) =>
        ns.map((n) => (!!n.selected === set.has(n.id) && !stale.has(n.id) ? n : { ...n, selected: set.has(n.id) })),
      ),
    [setNodes],
  );
  useEffect(() => {
    if (!editGestures) return;
    return store.subscribe((s, prev) => {
      if (!s.userSelectionActive || !s.userSelectionRect) {
        if (prev.userSelectionActive && !s.userSelectionActive) {
          // React Flow's last pick may have flipped its own flags after ours: one source of truth.
          const set = boxSet.current;
          if (set) {
            const stale = staleBoxFlags(s, set);
            if (stale.size) applyBoxPick(set, stale);
          }
          boxSet.current = null;
          boxBase.current = null;
          // React Flow shows its multi-selection frame (drag it, right-click it) from its own pick, which
          // it sets after this; follow ours instead: the combined selection, so a Shift-drag that adds nothing
          // keeps the frame of what was already selected.
          const any = set ? set.size > 0 : !!boxPicked.current;
          queueMicrotask(() => store.setState({ nodesSelectionActive: any }));
        }
        boxPicked.current = null;
        return;
      }
      if (s.userSelectionRect === prev.userSelectionRect && prev.userSelectionActive) return;
      const r = s.userSelectionRect;
      const [tx, ty, k] = s.transform;
      const box = { x: (r.x - tx) / k, y: (r.y - ty) / k, width: r.width / k, height: r.height / k };
      const items: BoxItem[] = [];
      for (const n of s.nodeLookup.values()) {
        const w = n.measured?.width ?? n.width ?? 0;
        const h = n.measured?.height ?? n.height ?? 0;
        if (n.hidden || n.selectable === false || !w || !h) continue;
        const backdrop =
          n.type === "boundary" || (n.type === "annotation" && (n as AnnotationFlowNode).data.kind === "zone");
        items.push({ id: n.id, ...n.internals.positionAbsolute, width: w, height: h, backdrop });
      }
      const base = boxBase.current;
      const picked = pickInBox(items, box, contain.current);
      const key = picked.join(" ");
      const set = new Set(base ? [...base.nodes, ...picked] : picked);
      const stale = staleBoxFlags(s, set);
      if (key === boxPicked.current && !stale.size) return;
      const pickChanged = key !== boxPicked.current;
      boxPicked.current = key;
      boxSet.current = set;
      applyBoxPick(set, stale);
      if (!pickChanged) return;
      const hiddenDeps = !dependencyVisibility.get();
      const edgeSet = edgesBetween(
        s.edges.filter((e) => !(hiddenDeps && isDependency(e.data))),
        set,
      );
      if (base) for (const id of base.edges) edgeSet.add(id);
      // The same array when no edge's flag changes: the routes and their caches stay as they are.
      setEdges((es) => {
        let changed = false;
        const next = es.map((e) => {
          if (!!e.selected === edgeSet.has(e.id)) return e;
          changed = true;
          return { ...e, selected: edgeSet.has(e.id) };
        });
        return changed ? next : es;
      });
    });
  }, [editGestures, store, setNodes, setEdges, applyBoxPick]);

  return { contain, boxBase };
}
