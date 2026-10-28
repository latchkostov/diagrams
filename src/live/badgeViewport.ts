import { refresh } from "./badgeSemantics";
import { sameParts } from "./badgeMemo";
import type { LiveController } from "./controller";
import { flushSync } from "react-dom";
import { registerFrameCapture } from "../canvas/camera/frameCapture";
import { viewportParts } from "../canvas/viewportParts";

/** Screen-only work may wait off-pane; an image capture needs every current readout synchronously. */
export function watchBadgeViewport(
  root: HTMLElement | null,
  changed: (query: ReturnType<typeof viewportParts> | null) => void,
  controller?: Pick<LiveController, "subscribe" | "getState" | "currentDiagram">,
  geometry?: {
    getState: () => Parameters<ReturnType<typeof viewportParts>>[0];
    subscribe: (listener: () => void) => () => void;
  },
) {
  const query = viewportParts();
  let mounted = true;
  let activeQuery: typeof query | null = query;
  let previous: ReadonlySet<string> | null | undefined;
  const update = (force = true) => {
    if (!mounted || !controller) return;
    const visible = geometry && activeQuery ? activeQuery(geometry.getState()) : null;
    if (force || !sameParts(previous, visible))
      refresh(root, controller.getState(), visible, controller.currentDiagram);
    previous = visible;
  };
  const unsubscribe = controller?.subscribe(() => update());
  const unsubscribeGeometry = geometry?.subscribe(() => update(false));
  const observer = new MutationObserver(() => update());
  if (root)
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "aria-label", "title"],
    });
  changed(query);
  update();
  const viewport = root?.querySelector(".react-flow__viewport");
  const unregister = viewport
    ? registerFrameCapture(viewport, () => {
        activeQuery = null;
        flushSync(() => {
          if (mounted) changed(null);
        });
        update();
        return () => {
          activeQuery = query;
          if (mounted) {
            changed(query);
            update();
          }
        };
      })
    : () => {};
  return () => {
    mounted = false;
    unregister();
    unsubscribe?.();
    unsubscribeGeometry?.();
    observer.disconnect();
  };
}
