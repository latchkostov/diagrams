import { useCallback, useSyncExternalStore } from "react";
import { useStoreApi } from "@xyflow/react";
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
  observe = true,
): DisplayedRoute | undefined {
  if (!observe) return natural;
  const frame = s.ldFrameRoutes?.get(id);
  return frame?.natural === natural ? frame?.displayed : natural;
}

/**
 * A settled frame's displayed routes, beside React Flow's store rather than in it: publishing a pass
 * notifies only the edges that show their displayed route and whose own entry changed. A store
 * update would run every node and edge subscription on each keystroke that moves a card.
 */
export class FrameRoutes {
  private routes: ReadonlyMap<string, FrameRoute> | undefined;
  private readonly listeners = new Map<string, Set<() => void>>();

  current(): ReadonlyMap<string, FrameRoute> | undefined {
    return this.routes;
  }

  /** Unchanged entries keep their identity, so their observers neither re-render nor wake. */
  publish(next: ReadonlyMap<string, FrameRoute> | undefined) {
    const previous = this.routes;
    if (next && sameFrameRoutes(previous, next)) return;
    if (!next && !previous) return;
    let merged: Map<string, FrameRoute> | undefined;
    if (next) {
      merged = new Map();
      for (const [id, route] of next) {
        const before = previous?.get(id);
        merged.set(id, before && sameFrameRoute(before, route) ? before : route);
      }
    }
    this.routes = merged;
    for (const [id, listeners] of this.listeners)
      if (previous?.get(id) !== merged?.get(id)) for (const listener of [...listeners]) listener();
  }

  subscribe(id: string, listener: () => void): () => void {
    let listeners = this.listeners.get(id);
    if (!listeners) this.listeners.set(id, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }
}

const frameRoutesByStore = new WeakMap<object, FrameRoutes>();

/**
 * The frame routes of one canvas. `useStoreApi()` returns a new wrapper per component;
 * its `getState` is the canvas store's own function, the same for every caller.
 */
export function frameRoutesOf(store: { getState: () => unknown }): FrameRoutes {
  let routes = frameRoutesByStore.get(store.getState);
  if (!routes) frameRoutesByStore.set(store.getState, (routes = new FrameRoutes()));
  return routes;
}

const unsubscribed = () => {};

export function useFrameRoute(id: string, natural: EdgeRoute | undefined, observe = true) {
  const routes = frameRoutesOf(useStoreApi());
  const subscribe = useCallback(
    (listener: () => void) => (observe ? routes.subscribe(id, listener) : unsubscribed),
    [routes, id, observe],
  );
  const snapshot = () => displayedRoute({ ldFrameRoutes: routes.current() }, id, natural, observe);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Keep the existing hidden tail until pin shaping has an explicit product rule (T05.02). */
export function editingRoute(displayed: DisplayedRoute | undefined, natural: EdgeRoute): EdgeRoute {
  return displayed?.frameClipped ? natural : (displayed ?? natural);
}

/** The same flow-space geometry for the same router revision. */
function sameFrameRoute(previous: FrameRoute, next: FrameRoute) {
  const before = previous.displayed.label;
  const after = next.displayed.label;
  return (
    previous.natural === next.natural &&
    previous.displayed.path === next.displayed.path &&
    previous.displayed.frameClipped === next.displayed.frameClipped &&
    !!(
      before === after ||
      (before &&
        after &&
        before.x === after.x &&
        before.y === after.y &&
        before.width === after.width &&
        before.height === after.height)
    )
  );
}

/** Preserve subscriptions when a pan produces the same flow-space geometry. */
export function sameFrameRoutes(a: FrameRoutesState["ldFrameRoutes"], b: ReadonlyMap<string, FrameRoute>) {
  if (a?.size !== b.size) return false;
  for (const [id, next] of b) {
    const previous = a.get(id);
    if (!previous || !sameFrameRoute(previous, next)) return false;
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
