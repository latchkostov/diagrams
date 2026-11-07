import { useCallback } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import type { EdgeRoute } from "../geometry/router";
import { pointAlong } from "../geometry/path";
import type { Point, Rect } from "../geometry/rect";

export type DisplayedRoute = EdgeRoute & { frameClipped?: boolean };
export type FrameRoute = { natural: EdgeRoute; displayed: DisplayedRoute };
export type FrameRoutesState = { ldFrameRoutes?: ReadonlyMap<string, FrameRoute> };

/** A settled frame may decorate a route only until the router replaces its natural geometry. */
export function displayedRoute(
  s: FrameRoutesState,
  id: string,
  natural: EdgeRoute | undefined,
): DisplayedRoute | undefined {
  const frame = s.ldFrameRoutes?.get(id);
  return frame?.natural === natural ? frame?.displayed : natural;
}

export function useFrameRoute(id: string, natural: EdgeRoute | undefined) {
  return useStore(
    useCallback((s: ReactFlowState) => displayedRoute(s as FrameRoutesState, id, natural), [id, natural]),
  );
}

/** Keep the existing hidden tail until pin shaping has an explicit product rule (T05.02). */
export function editingRoute(displayed: DisplayedRoute | undefined, natural: EdgeRoute): EdgeRoute {
  return displayed?.frameClipped ? natural : (displayed ?? natural);
}

/** Preserve subscriptions when a pan produces the same flow-space geometry. */
export function sameFrameRoutes(a: FrameRoutesState["ldFrameRoutes"], b: ReadonlyMap<string, FrameRoute>) {
  if (a?.size !== b.size) return false;
  for (const [id, next] of b) {
    const previous = a.get(id);
    const before = previous?.displayed.label;
    const after = next.displayed.label;
    if (
      previous?.natural !== next.natural ||
      previous.displayed.path !== next.displayed.path ||
      previous.displayed.frameClipped !== next.displayed.frameClipped ||
      !(
        before === after ||
        (before &&
          after &&
          before.x === after.x &&
          before.y === after.y &&
          before.width === after.width &&
          before.height === after.height)
      )
    )
      return false;
  }
  return true;
}

/** Carry a caption's offset from its natural segment onto that segment's displayed lane. */
export function frameLabelHome(box: Rect, natural: readonly Point[], displayed: readonly Point[]): Rect {
  if (natural.length < 2 || displayed.length < 2) return box;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let nearest = { distance: Infinity, k: 1, t: 0, x: 0, y: 0, along: 0 };
  let length = 0;
  for (let k = 1; k < natural.length; k++) {
    const a = natural[k - 1],
      b = natural[k];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const size = Math.hypot(dx, dy);
    const t = size ? Math.max(0, Math.min(1, ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / size ** 2)) : 0;
    const x = a.x + dx * t,
      y = a.y + dy * t;
    const distance = (centre.x - x) ** 2 + (centre.y - y) ** 2;
    if (distance < nearest.distance) nearest = { distance, k, t, x, y, along: length + size * t };
    length += size;
  }
  const a = displayed[nearest.k - 1],
    b = displayed[nearest.k];
  const at =
    natural.length === displayed.length
      ? { x: a.x + (b.x - a.x) * nearest.t, y: a.y + (b.y - a.y) * nearest.t }
      : pointAlong(displayed, length ? nearest.along / length : 0.5).point;
  return { ...box, x: box.x + at.x - nearest.x, y: box.y + at.y - nearest.y };
}
