import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { NodeTip } from "./NodeTooltip";

const DELAY = 550;

/**
 * Hover-intent state for the node tooltip: show after a pause, hide at once. Keyboard focus shows it
 * straight away (`immediate`). `show` and `hide` are stable, so callers can depend on them without
 * re-rendering every node when the tip changes.
 */
export function useNodeTooltip(enabled: boolean) {
  const [tip, setTip] = useState<NodeTip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setTip(null);
  }, []);
  const show = useCallback((el: Element, next: Omit<NodeTip, "rect">, immediate = false) => {
    clearTimeout(timer.current);
    if (!enabledRef.current) return;
    const open = () => setTip({ ...next, rect: el.getBoundingClientRect() });
    if (immediate) open();
    else timer.current = setTimeout(open, DELAY);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { tip: enabled ? tip : null, show, hide };
}

export const NODE_TIP_ID = "node-tooltip-content";

type TipData = Omit<NodeTip, "rect">;

/**
 * Keyboard parity for the node tooltip: focusing a node shows it at once, blur hides it, Esc
 * dismisses it, and the focused (or hovered) node is described by it for screen readers.
 */
export function useNodeTipKeyboard(
  root: RefObject<HTMLElement | null>,
  lookup: (id: string) => TipData | null,
  tip: NodeTip | null,
  show: (el: Element, next: TipData, immediate?: boolean) => void,
  hide: () => void,
) {
  const lookupRef = useRef(lookup);
  useEffect(() => {
    lookupRef.current = lookup;
  });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nodeOf = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.matches(".react-flow__node-diagram[data-id]") ? t : null;
    const onFocus = (e: FocusEvent) => {
      const node = nodeOf(e.target);
      const data = node && lookupRef.current(node.dataset.id!);
      if (node && data) show(node, data, true);
    };
    const onBlur = (e: FocusEvent) => nodeOf(e.target) && hide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    el.addEventListener("focusin", onFocus);
    el.addEventListener("focusout", onBlur);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("focusin", onFocus);
      el.removeEventListener("focusout", onBlur);
      el.removeEventListener("keydown", onKey);
    };
  }, [root, show, hide]);
  const nodeId = tip?.nodeId;
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
