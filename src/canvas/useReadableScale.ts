import { useStore } from "@xyflow/react";

/**
 * Hover cards drawn inside the flow viewport (a config edge's settings, a node's dependency list)
 * shrink with the zoom: at a large diagram's fit their 11 px text was 5 px on screen. Scaling them by
 * this keeps them at least their CSS size; zoomed in, they grow with the diagram as before.
 */
export function useReadableScale(): number {
  return useStore((s) => Math.max(1, 1 / s.transform[2]));
}
