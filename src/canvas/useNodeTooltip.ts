import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { NodeTip } from "./NodeTooltip";

const DELAY = 550;

/** The tip being shown, outside React state: only what draws it (NodeTipLayer) renders when it changes. */
export interface TipStore {
  get(): NodeTip | null;
  subscribe(listener: () => void): () => void;
}

function tipStore() {
  let tip: NodeTip | null = null;
  const listeners = new Set<() => void>();
  const store: TipStore & { set(next: NodeTip | null): void } = {
    get: () => tip,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      if (next === tip) return;
      tip = next;
      for (const l of listeners) l();
    },
  };
  return store;
}

/**
 * Hover-intent state for the node tooltip: show after a pause, hide at once. Keyboard focus shows it
 * straight away (`immediate`). `show` and `hide` are stable, so callers can depend on them without
 * re-rendering every node when the tip changes; the tip itself is in `tips`, so showing or hiding it doesn't
 * render the canvas either (NodeTipLayer draws it).
 */
export function useNodeTooltip(enabled: boolean) {
  const [tips] = useState(tipStore);
  const setTip = tips.set;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setTip(null);
  }, [setTip]);
  const show = useCallback(
    (el: Element, next: Omit<NodeTip, "rect">, immediate = false) => {
      clearTimeout(timer.current);
      if (!enabledRef.current) return;
      const open = () => setTip({ ...next, rect: el.getBoundingClientRect() });
      if (immediate) open();
      else timer.current = setTimeout(open, DELAY);
    },
    [setTip],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { tips: tips as TipStore, show, hide };
}

export const NODE_TIP_ID = "node-tooltip-content";

type TipData = Omit<NodeTip, "rect">;

/**
 * Keyboard parity for the node tooltip: focusing a node shows it at once, blur hides it, Esc
 * dismisses it (and the focused or hovered node is described by it for screen readers: useTipDescribes). A dismissed
 * tip stays dismissed while focus comes back to the same node (Esc's focus restore, after React Flow's
 * blur); focus moving to anything else re-arms it.
 */
export function useNodeTipKeyboard(
  root: RefObject<HTMLElement | null>,
  lookup: (id: string) => TipData | null,
  show: (el: Element, next: TipData, immediate?: boolean) => void,
  hide: () => void,
) {
  const lookupRef = useRef(lookup);
  useEffect(() => {
    lookupRef.current = lookup;
  });
  /** The node whose tip Esc dismissed, until focus moves somewhere else. */
  const dismissed = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nodeOf = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.matches(".react-flow__node-diagram[data-id]") ? t : null;
    const onFocus = (e: FocusEvent) => {
      const node = nodeOf(e.target);
      if (node && node === dismissed.current) return;
      dismissed.current = null;
      const data = node && lookupRef.current(node.dataset.id!);
      if (node && data) show(node, data, true);
    };
    const onBlur = (e: FocusEvent) => {
      if (!nodeOf(e.target)) return;
      hide();
      // Focus going to another element re-arms the tip; a blur to nowhere (React Flow's, on Esc) doesn't.
      if (e.relatedTarget) dismissed.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      hide();
      dismissed.current = nodeOf(e.target);
    };
    el.addEventListener("focusin", onFocus);
    el.addEventListener("focusout", onBlur);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("focusin", onFocus);
      el.removeEventListener("focusout", onBlur);
      el.removeEventListener("keydown", onKey);
    };
  }, [root, show, hide]);
}

/** The node the tip describes gets `aria-describedby` pointing at it while it shows. */
export function useTipDescribes(root: RefObject<HTMLElement | null>, nodeId: string | undefined) {
  useEffect(() => {
    if (!nodeId) return;
    const el = root.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
    if (!el) return;
    const previous = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", [previous, NODE_TIP_ID].filter(Boolean).join(" "));
    return () => {
      if (previous === null) el.removeAttribute("aria-describedby");
      else el.setAttribute("aria-describedby", previous);
    };
  }, [root, nodeId]);
}
