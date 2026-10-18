import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ReactFlowInstance, useStoreApi } from "@xyflow/react";
import { isDenyRule } from "../../stencils/netDevices";
import { edgeSettings, isDependency, RELATION_META, settingsSummary } from "../../model/relations";
import type { FlowSelection } from "../../editor/historySelection";
import type { NavStep } from "../../editor/useCanvasShortcuts";
import type { EditorApi } from "../../editor/types";
import { getNodeVariant, type NodeVariantId } from "../../harness/nodeVariants";
import { t as tr } from "../../i18n";
import { nodeAriaLabel, edgeAriaLabel, withEdgeAria, withNodeAria, withRovingFocus } from "../convert";
import { dependencyVisibility, projectDependencies, useShowDependencies } from "../dependencyVisibility";
import { pipsByNode } from "../nodes/dependencyRows";
import { nearestInDirection, readingOrder, stepInOrder, tabOrder, type NavBox } from "../keyboardNav";
import { annotationAriaLabel, annotationTitle } from "../annotations";
import { isAnnotationNode, isDiagramNode, isGroupNode } from "../nodeKinds";
import { GROUP_PREFIX, type DiagramFlowEdge, type FlowNode, type GroupFlowNode } from "../types";
import { useRevealFocused, type useRevealSelection, type CameraController } from "../camera";

export function useSelectionSummary(nodes: FlowNode[], edges: DiagramFlowEdge[]) {
  const diagramNodes = useMemo(() => nodes.filter(isDiagramNode), [nodes]);
  const groupNodes = useMemo(() => nodes.filter(isGroupNode), [nodes]);
  const annotationNodes = useMemo(() => nodes.filter(isAnnotationNode), [nodes]);
  const selectedNodes = useMemo(() => diagramNodes.filter((n) => n.selected), [diagramNodes]);
  const selectedAnnotations = useMemo(() => annotationNodes.filter((n) => n.selected), [annotationNodes]);
  const selectedGroups = useMemo(() => groupNodes.filter((n) => n.selected), [groupNodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const nothingSelected =
    !selectedNodes.length && !selectedGroups.length && !selectedEdges.length && !selectedAnnotations.length;
  // A single selected node or connection with findings shows them at the top of its inspector, with the fix.
  const soleId =
    selectedNodes.length + selectedGroups.length + selectedEdges.length + selectedAnnotations.length === 1
      ? (selectedNodes[0]?.id ?? selectedEdges[0]?.id)
      : undefined;
  return {
    diagramNodes,
    groupNodes,
    annotationNodes,
    selectedNodes,
    selectedAnnotations,
    selectedGroups,
    selectedEdges,
    nothingSelected,
    soleId,
  };
}

export function useCanvasNavigation({
  nodes,
  edges,
  labels,
  readOnly,
  direction,
  nodeVariant,
  controller,
  getNodes,
  store,
  editor,
  wrapper,
  revealSelection,
  setEdges,
  navigate: navigateRef,
  stepping: steppingRef,
  onHistoryStep: onHistoryStepRef,
  setAnnouncement,
}: {
  nodes: FlowNode[];
  edges: DiagramFlowEdge[];
  labels: ReadonlyMap<string, string>;
  readOnly: boolean;
  direction: "LR" | "TB";
  nodeVariant: NodeVariantId;
  controller: CameraController;
  getNodes: ReactFlowInstance<FlowNode, DiagramFlowEdge>["getNodes"];
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  editor: EditorApi;
  wrapper: RefObject<HTMLDivElement | null>;
  revealSelection: ReturnType<typeof useRevealSelection>["revealSelection"];
  setEdges: Dispatch<SetStateAction<DiagramFlowEdge[]>>;
  navigate: RefObject<(step: NavStep, from: EventTarget | null) => boolean>;
  stepping: RefObject<string | undefined>;
  onHistoryStep: RefObject<(direction: "undo" | "redo", selection: FlowSelection) => void>;
  setAnnouncement: Dispatch<SetStateAction<{ text: string; seq: number }>>;
}) {
  // ---------------------------------------------------------------- keyboard selection between nodes (D14)
  // The canvas is one Tab stop: the node last focused (else the first in reading order) is the one in the page's
  // Tab order. Inside, Tab and Shift+Tab step through nodes in reading order, Ctrl+Alt+arrows go to the nearest
  // node that way, and Ctrl+Alt+] / [ to a node's outgoing and incoming edges. Selection and focus move
  // together, the view follows, and a polite live region names what's selected.
  const [focusId, setFocusId] = useState<string | undefined>();
  /** The node keyboard selection is focusing: it brings it into view itself (revealSelection). */
  const navFocus = useRef<string | undefined>(undefined);
  const revealFocusedRef = useRevealFocused(controller);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!wrap) return;
    const onFocus = (e: FocusEvent) => {
      const id = e.target instanceof Element ? e.target.closest(".react-flow__node")?.getAttribute("data-id") : null;
      if (!id) return;
      setFocusId(id);
      const own = navFocus.current === id;
      // The node itself, by keyboard (a click is on a node in view; an editor inside it isn't the node).
      const node = e.target instanceof HTMLElement && e.target.classList.contains("react-flow__node");
      if (!own && node && (e.target as HTMLElement).matches(":focus-visible"))
        revealFocusedRef.current(id, e.target as HTMLElement);
    };
    wrap.addEventListener("focusin", onFocus);
    return () => wrap.removeEventListener("focusin", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
  }, [revealFocusedRef]);
  const { width: nominalW, height: nominalH } = getNodeVariant(nodeVariant).size;
  const navBox = useCallback(
    (n: FlowNode): NavBox => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.measured?.width ?? n.width ?? nominalW,
      height: n.measured?.height ?? n.height ?? nominalH,
    }),
    [nominalW, nominalH],
  );
  /** Tab's order: reading order, each boundary just before its first member, an empty one where it reads. */
  const navOrder = useCallback(
    (ns: readonly FlowNode[]) =>
      tabOrder(
        ns.filter((n) => !isGroupNode(n)).map(navBox),
        ns.filter(isGroupNode).map((g) => ({
          ...navBox(g),
          members: ns.filter((m) => m.data.group === g.data.groupId).map((m) => m.id),
        })),
        direction,
      ),
    [navBox, direction],
  );
  const rovingId = useMemo(() => {
    if (readOnly) return undefined;
    if (focusId && nodes.some((n) => n.id === focusId && !n.hidden)) return focusId;
    // The first thing Tab would meet, a boundary included: a diagram of boundaries only is still reachable.
    return navOrder(nodes.filter((n) => !n.hidden))[0];
  }, [readOnly, focusId, nodes, navOrder]);
  // Accessible names follow renames (React Flow names focusable nodes / edges from ariaLabel).
  // Only one node is in the page's Tab order (see above).
  const ariaNodes = useMemo(
    () => (readOnly ? withNodeAria(nodes) : withRovingFocus(withNodeAria(nodes), rovingId)),
    [nodes, readOnly, rovingId],
  );
  /** What the live region says (seq: the same words again are read again). */

  // eslint-disable-next-line react-hooks/exhaustive-deps -- setAnnouncement is CanvasView's stable state setter; preserve the original dependencies
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, seq: a.seq + 1 })), []);
  useLayoutEffect(() => {
    navigateRef.current = (step, from) => {
      const ns = getNodes().filter((n) => !n.hidden);
      const es = store.getState().edges.filter((e) => !e.hidden);
      const el = from instanceof Element ? from : null;
      const focusedNode = steppingRef.current ?? el?.closest(".react-flow__node")?.getAttribute("data-id") ?? undefined;
      const focusedEdge = el?.closest(".react-flow__edge")?.getAttribute("data-id") ?? undefined;
      const sel = editor.getSelection();
      const selectedFlowIds = [...sel.nodeIds, ...sel.groupIds.map((g) => GROUP_PREFIX + g)];
      const current = focusedNode ?? (!focusedEdge && selectedFlowIds.length === 1 ? selectedFlowIds[0] : undefined);
      const labelOf = (id: string) => {
        const n = ns.find((x) => x.id === id);
        if (!n) return id;
        if (isDiagramNode(n)) return n.data.label || n.id;
        if (isAnnotationNode(n)) return annotationTitle(n.data);
        return (n as GroupFlowNode).data.label || tr("chrome.untitledBoundary");
      };
      const order = navOrder(ns);

      const goNode = (id: string) => {
        const n = ns.find((x) => x.id === id);
        if (!n) return false;
        if (isGroupNode(n)) editor.select({ groupIds: [n.data.groupId] });
        else editor.select({ nodeIds: [id] });
        setFocusId(id);
        steppingRef.current = id;
        requestAnimationFrame(() => {
          if (steppingRef.current === id) steppingRef.current = undefined;
          // Focus events fire inside focus(): the flag covers exactly this one.
          navFocus.current = id;
          wrapper.current
            ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
            ?.focus({ preventScroll: true });
          navFocus.current = undefined;
        });
        revealSelection(undefined, 0, "navigation");
        const at = `${order.indexOf(id) + 1} of ${order.length}`;
        if (isDiagramNode(n)) {
          const outs = es.filter((e) => e.source === id).length;
          const ins = es.filter((e) => e.target === id).length;
          const inGroup = n.data.group ? editor.getGroup(n.data.group)?.label : undefined;
          const edges = outs + ins ? `${outs} out, ${ins} in` : "no connections";
          // Hidden dependencies show as pips, whose list opens on the focused node: say it too.
          const pips = dependencyVisibility.get() ? [] : (pipsByNode(store.getState().edges).get(id) ?? []);
          const deps = pips.length
            ? ` Dependencies: ${pips.map((r) => `${RELATION_META[r.relation].label} · ${labelOf(r.target)}`).join(", ")}.`
            : "";
          announce(`${nodeAriaLabel(n.data)}${inGroup ? `, in ${inGroup}` : ""}. ${at}. ${edges}.${deps}`);
        } else if (isAnnotationNode(n)) announce(`${annotationAriaLabel(n.data)}. ${at}.`);
        else {
          const members = ns.filter(
            (m) => (isDiagramNode(m) || isAnnotationNode(m)) && m.data.group === (n as GroupFlowNode).data.groupId,
          );
          announce(`${labelOf(id)}, boundary, ${members.length === 1 ? "1 node" : `${members.length} nodes`}. ${at}.`);
        }
        return true;
      };

      if (step === "next" || step === "prev") {
        // From an edge, the order goes on from its source.
        const start = current ?? (focusedEdge ? es.find((e) => e.id === focusedEdge)?.source : undefined);
        if (!start && el?.matches('[data-testid="canvas-wrap"]') === false) return false;
        const next = start ? stepInOrder(order, start, step === "prev") : (rovingId ?? order[0]);
        return next ? goNode(next) : false;
      }

      if (step === "edge-out" || step === "edge-in") {
        // From a node: its first outgoing (or incoming) edge; again from that edge: the node's next one.
        const edge = focusedEdge ? es.find((e) => e.id === focusedEdge) : undefined;
        const out = step === "edge-out";
        const anchor = edge ? (out ? edge.source : edge.target) : current;
        if (!anchor || anchor.startsWith(GROUP_PREFIX)) return false;
        const pos = new Map(order.map((id, i) => [id, i]));
        const list = es
          .filter((e) => (out ? e.source : e.target) === anchor)
          .sort((a, b) => (pos.get(out ? a.target : a.source) ?? 0) - (pos.get(out ? b.target : b.source) ?? 0));
        if (!list.length) {
          announce(`${labelOf(anchor)} has no ${out ? "outgoing" : "incoming"} edges.`);
          return false;
        }
        const i = edge ? list.findIndex((e) => e.id === edge.id) : -1;
        const e = list[(i + 1) % list.length];
        editor.select({ edgeIds: [e.id] });
        requestAnimationFrame(() =>
          wrapper.current
            ?.querySelector<SVGElement>(`.react-flow__edge[data-id="${CSS.escape(e.id)}"]`)
            ?.focus({ preventScroll: true }),
        );
        revealSelection(undefined, 0, "navigation");
        const said = edgeAriaLabel(
          labelOf(e.source),
          labelOf(e.target),
          e.data?.kind,
          e.data?.label,
          e.data?.relation,
          isDenyRule(e.data?.props),
        );
        const settings = settingsSummary(edgeSettings(e.data));
        announce(
          `${said}.${settings ? ` ${settings}.` : ""} ${out ? "Outgoing" : "Incoming"} ${list.indexOf(e) + 1} of ${list.length}.`,
        );
        return true;
      }

      // Ctrl+Alt+arrows: the nearest node that way (boundaries and zones are backdrops, not stops).
      const stops = ns.filter((n) => !isGroupNode(n) && !(isAnnotationNode(n) && n.data.kind === "zone")).map(navBox);
      let fromBox = current ? stops.find((b) => b.id === current) : undefined;
      if (!fromBox && focusedEdge) {
        // From an edge: halfway along it.
        const e = es.find((x) => x.id === focusedEdge);
        const a = e && stops.find((b) => b.id === e.source);
        const b = e && stops.find((x) => x.id === e.target);
        if (a && b)
          fromBox = {
            id: focusedEdge,
            x: (a.x + a.width / 2 + b.x + b.width / 2) / 2,
            y: (a.y + a.height / 2 + b.y + b.height / 2) / 2,
            width: 0,
            height: 0,
          };
      }
      if (!fromBox) {
        // Nothing selected: the first thing in Tab's order (a boundary, when there are only boundaries).
        const first = readingOrder(stops, direction)[0]?.id ?? order[0];
        return first ? goNode(first) : false;
      }
      const to = nearestInDirection(fromBox, stops, step);
      if (!to) {
        announce(
          `Nothing ${step === "right" ? "to the right" : step === "left" ? "to the left" : step === "up" ? "above" : "below"}.`,
        );
        return false;
      }
      return goNode(to);
    };
  });
  // Undo and Redo select what the step changed (historySelection.ts). From the canvas (focus on a node, an
  // edge or the canvas itself), focus goes with it: onto the first selected node in Tab's order (else the
  // first selected edge, else the canvas, never a node that's gone or no longer selected), revealed and
  // announced. From the toolbar, the inspector or a panel, focus stays put; Tab into the canvas still lands on
  // the selection.
  useLayoutEffect(() => {
    onHistoryStepRef.current = (direction, selection) => {
      const wrap = wrapper.current;
      const active = document.activeElement;
      const fromCanvas =
        !!wrap &&
        !!active &&
        wrap.contains(active) &&
        (active === wrap || !!active.closest(".react-flow__node, .react-flow__edge"));
      // After React has drawn the restored canvas.
      requestAnimationFrame(() => {
        const ns = getNodes().filter((n) => !n.hidden);
        const picked = new Set(selection.nodes);
        const target = navOrder(ns).find((id) => picked.has(id));
        if (target) setFocusId(target);
        if (!fromCanvas || !wrap) return;
        // Once what's selected is measured (React Flow hides a node until then, and a hidden one can't take
        // focus), and while the view pans to it.
        revealSelection(
          () => {
            const edge = target ? undefined : selection.edges[0];
            const el = target
              ? wrap.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(target)}"]`)
              : edge
                ? wrap.querySelector<HTMLElement>(`.react-flow__edge[data-id="${CSS.escape(edge)}"]`)
                : null;
            navFocus.current = target;
            el?.focus({ preventScroll: true });
            // An edge that isn't a Tab stop, or nothing to focus: the canvas, not the page.
            if (!el || document.activeElement !== el) wrap.focus({ preventScroll: true });
            navFocus.current = undefined;
            const count = selection.nodes.length + selection.edges.length;
            const only = count === 1 && target ? ns.find((n) => n.id === target) : undefined;
            const name = !only
              ? undefined
              : isDiagramNode(only)
                ? only.data.label || only.id
                : isAnnotationNode(only)
                  ? annotationTitle(only.data)
                  : (only as GroupFlowNode).data.label || tr("chrome.untitledBoundary");
            const what = !count
              ? tr("chrome.nothingSelected")
              : name
                ? tr("chrome.valueSelected", { name })
                : tr("ai.selected", { count });
            announce(
              direction === "undo"
                ? tr("chrome.undoneValue", { selection: what })
                : tr("chrome.redoneValue", { selection: what }),
            );
          },
          0,
          "navigation",
        );
      });
    };
  });
  const showDependencies = useShowDependencies();
  useEffect(
    () =>
      dependencyVisibility.subscribe(() => {
        if (dependencyVisibility.get()) return;
        if (document.activeElement?.closest('[data-dependency="true"]')) wrapper.current?.focus();
        setEdges((es) => es.map((e) => (e.selected && isDependency(e.data) ? { ...e, selected: false } : e)));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
    [setEdges],
  );
  const ariaEdges = useMemo(
    () =>
      projectDependencies(
        withEdgeAria(edges, (id) => labels.get(id) ?? id),
        showDependencies,
      ),
    [edges, labels, showDependencies],
  );
  return { ariaNodes, ariaEdges };
}
