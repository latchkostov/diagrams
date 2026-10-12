import { useLayoutEffect, useState, type RefObject } from "react";

/** Where an element's bottom edge is, relative to its offset parent (for a card that sits just under it). */
export function useBelow(el: RefObject<HTMLElement | null>, enabled: boolean, gap = 8): number {
  const [below, setBelow] = useState(0);
  useLayoutEffect(() => {
    const node = el.current;
    if (!enabled || !node) return;
    const measure = () => setBelow(node.hidden ? 16 : node.offsetTop + node.offsetHeight + gap);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el, enabled, gap]);
  return below;
}
