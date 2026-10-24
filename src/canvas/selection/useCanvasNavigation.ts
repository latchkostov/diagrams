import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ReactFlowInstance, useStoreApi } from "@xyflow/react";
import { isDenyRule } from "../../stencils/netDevices";
import { edgeSettings, isDependency, RELATION_META, settingsSummary } from "../../model/relations";
import type { FlowSelection } from "../../editor/historySelection";
import { inCanvas, type NavStep } from "../../editor/useCanvasShortcuts";
import { isEditableTarget } from "../../editor/shortcuts";
import type { EditorApi } from "../../editor/types";
import { getNodeVariant, type NodeVariantId } from "../../harness/nodeVariants";
import { t as tr } from "../../i18n";
import { nodeAriaLabel, edgeAriaLabel, withEdgeAria, withNodeAria, withRovingFocus } from "../convert";
import { dependencyVisibility, projectDependencies, useShowDependencies } from "../dependencyVisibility";
import { pipsByNode } from "../nodes/dependencyRows";
import { nearestInDirection, readingOrder, stepInOrder, tabOrder, type NavBox } from "../keyboardNav";
import { annotationAriaLabel, annotationTitle } from "../annotations";
import { isAnnotationNode, isDiagramNode, isGroupNode } from "../types";
import { GROUP_PREFIX, type DiagramFlowEdge, type FlowNode, type GroupFlowNode } from "../types";
import { useRevealFocused, type useRevealSelection, type CameraController } from "../camera";
import type { FocusApi } from "../interaction";
import type { InteractionController } from "../interaction/controller";

/** Memoize a filtered projection by its members, rather than by the whole graph's identity. */
function sharedFilter<T, U extends T>(predicate: (value: T) => value is U) {
  let previous: U[] = [];
  return (values: T[]) => {
    const next = values.filter(predicate);
    if (next.length !== previous.length || next.some((value, i) => value !== previous[i])) previous = next;
    return previous;
  };
}

export function useSelectionSummary(nodes: FlowNode[], edges: DiagramFlowEdge[]) {
  const diagramNodes = useMemo(() => nodes.filter(isDiagramNode), [nodes]);
  const [groups] = useState(() => sharedFilter(isGroupNode));
  const [annotations] = useState(() => sharedFilter(isAnnotationNode));
  const groupNodes = groups(nodes);
  const annotationNodes = annotations(nodes);
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
  onHistoryStep: onHistoryStepRef,
  setAnnouncement,
  interaction,
  roving,
  setOrder,
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
  onHistoryStep: RefObject<(direction: "undo" | "redo", selection: FlowSelection) => void>;
  setAnnouncement: Dispatch<SetStateAction<{ text: string; seq: number }>>;
  /** The focus controller: it moves focus, and holds the canvas's Tab stop (`roving`). */
  interaction: FocusApi;
  roving: string | undefined;
  setOrder: (order: (ids: readonly string[]) => string[]) => void;
}) {
  // ---------------------------------------------------------------- keyboard selection between nodes (D14)
  // The canvas is one Tab stop: the node last focused (else the first in reading order) is the one in the page's
  // Tab order. Inside, Tab and Shift+Tab step through nodes in reading order, Ctrl+Alt+arrows go to the nearest
  // node that way, and Ctrl+Alt+] / [ to a node's outgoing and incoming edges. Selection and focus move
  // together, the view follows, and a polite live region names what's selected. The focus controller moves focus
  // (src/canvas/interaction) and holds the Tab stop: `roving`, the node last focused.
  const focusId = roving;
  const revealFocusedRef = useRevealFocused(controller);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!wrap) return;
    const onFocus = (e: FocusEvent) => {
      const id = e.target instanceof Element ? e.target.closest(".react-flow__node")?.getAttribute("data-id") : null;
      if (!id) return;
      // Keyboard selection and Undo bring what they focus into view themselves (revealSelection).
      const own = !!interaction.focusing?.revealed;
      interaction.dispatch({ type: "focus.entered", id });
      // The node itself, by keyboard (a click is on a node in view; an editor inside it isn't the node).
      const node = e.target instanceof HTMLElement && e.target.classList.contains("react-flow__node");
      if (!own && node && (e.target as HTMLElement).matches(":focus-visible"))
        revealFocusedRef.current(id, e.target as HTMLElement);
    };
    wrap.addEventListener("focusin", onFocus);
    return () => wrap.removeEventListener("focusin", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
  }, [revealFocusedRef, interaction]);
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
  useLayoutEffect(() =>
    // Undo's target: the first selected node in Tab's order.
    setOrder((ids) => {
      const picked = new Set(ids);
      return navOrder(getNodes().filter((n) => !n.hidden)).filter((id) => picked.has(id));
    }),
  );
  useLayoutEffect(() => {
    navigateRef.current = (step, from) => {
      const ns = getNodes().filter((n) => !n.hidden);
      const es = store.getState().edges.filter((e) => !e.hidden);
      const el = from instanceof Element ? from : null;
      // A step's destination until focus lands there, a node's or an edge's: a second Tab or Ctrl+Alt+] in the same
      // frame (two presses queued behind a busy moment) goes on from there, not from what the key event still targets.
      const pending = interaction.pendingTarget();
      const focusedNode = pending
        ? pending.kind === "node"
          ? pending.id
          : undefined
        : (el?.closest(".react-flow__node")?.getAttribute("data-id") ?? undefined);
      const focusedEdge = pending
        ? pending.kind === "edge"
          ? pending.id
          : undefined
        : (el?.closest(".react-flow__edge")?.getAttribute("data-id") ?? undefined);
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
        // Focus follows on the next frame, and the Tab stop moves now (K1).
        interaction.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id } });
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

      /** Selects and focuses a connection (next frame), bringing it into view; false if it has gone. */
      const goEdge = (id: string, where = "") => {
        const e = es.find((x) => x.id === id);
        if (!e) return false;
        editor.select({ edgeIds: [e.id] });
        interaction.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "edge", id: e.id } });
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
        announce(`${said}.${settings ? ` ${settings}.` : ""}${where}`);
        return true;
      };

      if (step === "next" || step === "prev") {
        const back = step === "prev";
        // Live's readout cards are portalled outside canvas-wrap; its layer bridges them into this reading order.
        const readouts = interaction.readouts;
        const bridged =
          pending || !readouts
            ? undefined
            : readouts.tab(el, back, {
                has: (t) => (t.kind === "node" ? ns : es).some((x) => x.id === t.id),
                go: (t) => (t.kind === "node" ? goNode(t.id) : goEdge(t.id)),
                after: (t) => {
                  const after = t.kind === "node" ? t.id : es.find((e) => e.id === t.id)?.source;
                  return after ? stepInOrder(order, after) : null;
                },
              });
        if (bridged !== undefined) return bridged;
        // Tab from an item whose readout is shown enters the readout before the next node.
        const item = focusedNode
          ? { kind: "node" as const, id: focusedNode }
          : focusedEdge
            ? { kind: "edge" as const, id: focusedEdge }
            : undefined;
        if (!back && !pending && item && readouts?.enter(item)) return true;
        // From an edge, the order goes on from its source.
        const start = current ?? (focusedEdge ? es.find((e) => e.id === focusedEdge)?.source : undefined);
        if (!start && el?.matches('[data-testid="canvas-wrap"]') === false) return false;
        const next = start ? stepInOrder(order, start, back) : (rovingId ?? order[0]);
        if (!next || !goNode(next)) return false;
        // Shift+Tab retraces Tab: in Live, back through the previous node's readout before the node itself.
        const prior = ns.find((n) => n.id === next);
        if (back && start && prior && isDiagramNode(prior)) readouts?.retrace({ kind: "node", id: next });
        return true;
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
        return goEdge(e.id, ` ${out ? "Outgoing" : "Incoming"} ${list.indexOf(e) + 1} of ${list.length}.`);
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
      // H1 / H2: from the canvas, focus goes to the first selected node in Tab's order (else the first selected
      // edge, else the canvas) once React has drawn and measured it; from elsewhere only the Tab stop moves.
      interaction.dispatch(
        {
          type: "selection.changed",
          cause: direction,
          selection: { nodes: selection.nodes, edges: selection.edges },
          origin: fromCanvas ? "canvas" : "elsewhere",
        },
        () => {
          if (!fromCanvas) return;
          const ns = getNodes().filter((n) => !n.hidden);
          const picked = new Set(selection.nodes);
          const target = navOrder(ns).find((id) => picked.has(id));
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
      );
      // The view pans to it meanwhile, once it's measured.
      if (fromCanvas) revealSelection(undefined, 0, "navigation");
    };
  });
  const showDependencies = useShowDependencies();
  useEffect(
    () =>
      dependencyVisibility.subscribe(() => {
        if (dependencyVisibility.get()) return;
        interaction.dispatch({
          type: "dependencies.hidden",
          focusOnDependency: !!document.activeElement?.closest('[data-dependency="true"]'),
        });
        setEdges((es) => es.map((e) => (e.selected && isDependency(e.data) ? { ...e, selected: false } : e)));
      }),
    [setEdges, interaction],
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

export function usePanKeys(
  wrapper: RefObject<HTMLDivElement | null>,
  editGestures: boolean,
  interaction: Pick<InteractionController, "setPanHeld">,
) {
  // ---------------------------------------------------------------- Space, Alt and the middle button (D4, D9)
  // Space held: a drag pans from anywhere, even starting on a node (nodes don't drag meanwhile), with a
  // grab cursor. Alt held over a selected node: the copy cursor (Alt-drag duplicates).
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!editGestures || !wrap) return;
    const setSpace = (on: boolean) => {
      interaction.setPanHeld(on);
      wrap.classList.toggle("is-space-pan", on);
      setSpaceHeld(on);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") wrap.classList.toggle("is-alt", e.type === "keydown");
      if (e.code !== "Space") return;
      if (e.type === "keyup") return setSpace(false);
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (!(e.target === document.body || inCanvas(e.target))) return;
      // Not a page scroll, and not a key press on a focused node.
      e.preventDefault();
      setSpace(true);
    };
    const reset = () => {
      wrap.classList.remove("is-alt");
      setSpace(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", reset);
      reset();
    };
  }, [editGestures, interaction, wrapper]);

  // The middle button pans (everywhere); it never starts the browser's autoscroll.
  useEffect(() => {
    const wrap = wrapper.current;
    const noAutoscroll = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    wrap?.addEventListener("mousedown", noAutoscroll);
    return () => wrap?.removeEventListener("mousedown", noAutoscroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
  }, []);

  return spaceHeld;
}
