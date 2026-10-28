import { flushSync } from "react-dom";
import { registerFrameCapture } from "../canvas/camera/frameCapture";
import { viewportParts } from "../canvas/viewportParts";

/** Screen-only work may wait off-pane; an image capture needs every current readout synchronously. */
export function watchBadgeViewport(
  root: HTMLElement | null,
  changed: (query: ReturnType<typeof viewportParts> | null) => void,
) {
  const query = viewportParts();
  let mounted = true;
  changed(query);
  const viewport = root?.querySelector(".react-flow__viewport");
  const unregister = viewport
    ? registerFrameCapture(viewport, () => {
        flushSync(() => {
          if (mounted) changed(null);
        });
        return () => {
          if (mounted) changed(query);
        };
      })
    : () => {};
  return () => {
    mounted = false;
    unregister();
  };
}
