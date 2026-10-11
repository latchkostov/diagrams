import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeTip } from "./NodeTooltip";

const DELAY = 550;

/** Hover-intent state for the node tooltip: show after a pause, hide at once. */
export function useNodeTooltip(enabled: boolean) {
  const [tip, setTip] = useState<NodeTip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setTip(null);
  }, []);
  const show = useCallback(
    (el: Element, next: Omit<NodeTip, "rect">) => {
      clearTimeout(timer.current);
      if (!enabled) return;
      timer.current = setTimeout(() => setTip({ ...next, rect: el.getBoundingClientRect() }), DELAY);
    },
    [enabled],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { tip: enabled ? tip : null, show, hide };
}
