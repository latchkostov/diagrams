import { OVERLAY_SELECTOR } from "./useOverlayFit";

/** Only floating chrome can hold a fit. Never enumerate the scene's decorative animations. */
export function overlayAnimations(root: HTMLElement, wake: () => void, discovered: () => void) {
  let cached: Animation[] | undefined;
  let overlays: HTMLElement[] = [];
  const watching = new WeakSet<Animation>();
  const invalidate = () => {
    cached = undefined;
    wake();
  };
  return {
    invalidate,
    changed(records: MutationRecord[]) {
      if (
        records.some((record) => {
          const target = record.target;
          return (
            (target === root && (record.attributeName === "class" || record.attributeName === "style")) ||
            (target instanceof Element &&
              target !== root &&
              (overlays.some(
                (overlay) =>
                  overlay === target ||
                  overlay.contains(target) ||
                  (record.type === "attributes" && target.contains(overlay)),
              ) ||
                ((record.attributeName === "class" ||
                  record.attributeName === "data-canvas-overlay" ||
                  record.attributeName === "data-testid") &&
                  target.matches(OVERLAY_SELECTOR)))) ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element && (node.matches(OVERLAY_SELECTOR) || !!node.querySelector(OVERLAY_SELECTOR)),
            )
          );
        })
      )
        invalidate();
    },
    pending(confirm = false) {
      // WAAPI can start without a DOM mutation. The confirming rendered sample
      // must refresh native overlay animations before readiness can complete.
      if (confirm) cached = undefined;
      if (!cached) {
        discovered();
        cached = [];
        const seen = new Set<Animation>();
        overlays = [...root.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)];
        for (const overlay of overlays)
          for (const animation of overlay.getAnimations({ subtree: true }))
            if (!seen.has(animation)) {
              seen.add(animation);
              cached.push(animation);
            }
      }
      let pending = false;
      for (const animation of cached) {
        if (
          animation.playState === "finished" ||
          animation.playState === "idle" ||
          animation.effect?.getComputedTiming().endTime === Infinity
        )
          continue;
        pending = true;
        if (!watching.has(animation)) {
          watching.add(animation);
          void animation.finished.then(invalidate, invalidate);
        }
      }
      return pending;
    },
  };
}
