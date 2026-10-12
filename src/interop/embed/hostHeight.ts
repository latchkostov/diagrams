import type { ReactFlowState } from "@xyflow/react";
import { overlayRects } from "../../canvas/useOverlayFit";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";

// The host-supplied embed's auto-height: the iframe height that shows the whole diagram at the frame's width.

type State = ReactFlowState<FlowNode, DiagramFlowEdge>;

/** The auto-height a host may give its iframe: the diagram fitted to the frame's width, chrome included. */
export const HEIGHT = { min: 200, minLive: 380, max: 1600, margin: 40, maxZoom: 1.25 } as const;

/** The frame height that shows the whole diagram at the width it has, or null before nodes are measured. */
export function contentHeight(s: State, root: HTMLElement | null, live = false): number | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const n of s.nodeLookup.values()) {
    const w = n.measured?.width ?? 0;
    const h = n.measured?.height ?? 0;
    if (n.hidden || !w || !h) continue;
    const { x, y } = n.internals.positionAbsolute;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  if (!Number.isFinite(x0) || !s.width || !s.height) return null;
  // Room taken by the floating chrome (title card, live bar, toggle): what's anchored to the top or bottom
  // takes the same room whatever the frame's height, so the answer doesn't feed back on itself.
  let top = 0;
  let bottom = 0;
  for (const o of root ? overlayRects(root) : []) {
    if (o.y + o.height / 2 < s.height / 2) top = Math.max(top, o.y + o.height);
    else bottom = Math.max(bottom, s.height - o.y);
  }
  const zoom = Math.min(HEIGHT.maxZoom, (s.width - 2 * HEIGHT.margin) / Math.max(1, x1 - x0));
  const height = (y1 - y0) * zoom + top + bottom + 2 * HEIGHT.margin;
  // Live view's narration and trace card float over the top of the pane: a live frame keeps room for them.
  return Math.round(Math.min(HEIGHT.max, Math.max(live ? HEIGHT.minLive : HEIGHT.min, height)));
}
