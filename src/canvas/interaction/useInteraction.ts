import {
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { useStoreApi } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { createInteractionController, type InteractionCamera, type InteractionController } from "./controller";
import { createDomPort, domScheduler, type DomCanvas } from "./domPort";
import { interactionJournal } from "./journal";
import { dependencyVisibility } from "../dependencyVisibility";
import { useInteraction } from "./context";
import { canvasInteraction } from "./canvasInteraction";
export { InteractionContext, useInteraction } from "./context";
import { isDependency } from "../../model/relations";

/** The canvas's interaction controller, for what renders inside the canvas (the Inspector, its name fields). */

type Store = ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;

/**
 * The canvas's interaction controller: the single writer of its menus and of keyboard focus in it, with its DOM
 * port onto canvas-wrap, the diagram as last committed and React Flow's store. It publishes data-interaction-state
 * (idle | menu-open | focus-pending) on canvas-wrap and, in e2e builds, the journal (window.__interactionJournal).
 */
export function useInteractionCore<P>(
  wrapper: RefObject<HTMLDivElement | null>,
  store: Store,
  nodes: FlowNode[],
  edges: DiagramFlowEdge[],
) {
  const [{ controller, setOrder, commit }] = useState(() => {
    /** The diagram as last committed: a node React Flow's store hasn't caught up with yet isn't gone. */
    let committed = { nodes: [] as FlowNode[], edges: [] as DiagramFlowEdge[] };
    let ids: { nodes: Set<string>; edges: Map<string, DiagramFlowEdge> } | null = null;
    let version = 0;
    const known = () =>
      (ids ??= {
        nodes: new Set(committed.nodes.filter((n) => !n.hidden).map((n) => n.id)),
        edges: new Map(committed.edges.map((e) => [e.id, e])),
      });
    const canvas: DomCanvas = {
      root: () => wrapper.current,
      hasNode: (id) => {
        const n = store.getState().nodeLookup.get(id);
        return (!!n && !n.hidden) || known().nodes.has(id);
      },
      hasEdge: (id) => {
        const e = known().edges.get(id) ?? store.getState().edgeLookup.get(id);
        return !!e && !e.hidden && (dependencyVisibility.get() || !isDependency(e.data));
      },
      version: () => version,
      publish: (phase) => {
        if (wrapper.current) wrapper.current.dataset.interactionState = phase;
      },
    };
    return {
      /** Keyboard navigation's Tab order, for Undo's "the first selected node in Tab's order". */
      setOrder: (order: (ids: readonly string[]) => string[]) => void (canvas.order = order),
      commit(next: { nodes: FlowNode[]; edges: DiagramFlowEdge[] }) {
        if (next.nodes === committed.nodes && next.edges === committed.edges) return;
        committed = next;
        ids = null;
        version++;
      },
      controller: createInteractionController<P>(createDomPort(canvas), domScheduler, { journal: interactionJournal }),
    };
  });
  // Publish membership before child layout effects request their fields. A new boundary's Inspector can
  // ask for Label before React Flow's passive store update; it must already be known to the DOM port.
  // This only updates the port's snapshot: it neither reads DOM refs nor schedules React updates.
  useInsertionEffect(() => commit({ nodes, edges }), [commit, nodes, edges]);
  useInteractionLifecycle(controller);
  // What's on screen, for readers outside the canvas (a tutorial): the editor's mode and its guide.
  useEffect(() => canvasInteraction.publish(controller), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { controller, state, setOrder };
}

/** The camera hears of menus opening and closing (it holds pane work while one is open). */
export function useInteractionCamera<P>(controller: InteractionController<P>, camera: InteractionCamera) {
  useLayoutEffect(() => controller.attachCamera(camera), [controller, camera]);
}

/**
 * Each commit's selection, for the one selection.changed event (with the cause its source declared) that the focus
 * policy and the camera both hear. After usePaneCamera, so a pane change in the same commit reaches the camera first.
 */
export function useSelectionEvents<P>(
  controller: InteractionController<P>,
  nodes: FlowNode[],
  edges: DiagramFlowEdge[],
  /** The annotation whose text editor is open: the editor's mode hears it with the same commit. */
  annotating: string | null = null,
) {
  const { key, empty } = useMemo(() => {
    const ids = [
      ...nodes.filter((n) => n.selected).map((n) => n.id),
      ...edges.filter((e) => e.selected).map((e) => e.id),
    ];
    return { key: JSON.stringify(ids), empty: ids.length === 0 };
  }, [nodes, edges]);
  useLayoutEffect(() => controller.selectionCommitted(key, empty, annotating));
  /** The same selection, as a key (a room's presence reuses it). */
  return key;
}

/** Input, commits and the lifetime of a controller (the canvas's, or the Lab Inspector's own). */
export function useInteractionLifecycle<P>(controller: InteractionController<P> | null) {
  useEffect(() => controller?.connect(), [controller]);
  useEffect(() => {
    if (!controller) return;
    // Capture input before anything handles it: a move's second attempt stands down (a press also ends a held rename).
    const press = () => controller.input("press");
    const key = (event: KeyboardEvent) => {
      controller.input("key");
      if (controller.captureKey(event)) return;
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const overlay = document.querySelector('[role="dialog"]')
        ? "dialog"
        : document.querySelector('[role="menu"]')
          ? "menu"
          : undefined;
      if (!controller.escape(overlay)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blur = () => {
      if (controller.gesture) controller.endGesture(controller.gesture.seq, "blur");
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Element) controller.focusArrived(event.target);
    };
    // Focus going nowhere (a field removed, a click on the page): the editor's mode leaves the field.
    const focusout = (event: FocusEvent) => {
      if (!event.relatedTarget) controller.focusLeft();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("focusin", focusin, true);
    window.addEventListener("focusout", focusout, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("focusin", focusin, true);
      window.removeEventListener("focusout", focusout, true);
    };
  }, [controller]);
  // Every commit: a move waiting for it runs, and a target waiting for its panel is tried again.
  useLayoutEffect(() => controller?.rendered());
}

/**
 * The canvas's controller, or (outside a canvas: the Lab's Inspector) one of its own, so the Inspector's fields
 * take focus the same way everywhere.
 */
export function useInteractionOrLocal(): { controller: InteractionController; local: boolean } {
  const shared = useInteraction();
  const [own] = useState(() =>
    shared
      ? null
      : createInteractionController(createDomPort({ root: () => null }), domScheduler, { journal: interactionJournal }),
  );
  const controller = shared ?? own!;
  useInteractionLifecycle(own);
  return { controller, local: !shared };
}
