import { loadOnce } from "../../lib/lazyLoad";
import { geometryChanged } from "../shapes/runtime";

export let routeGeometry: typeof import("./shaped") | undefined;
export const loadShapedRoutes = loadOnce(async () => {
  routeGeometry = await import("./shaped");
  geometryChanged();
  return routeGeometry;
});

/** Headless callers can prepare an input without depending on UI loader side effects. */
export async function whenRouteGeometryReady<T extends { edges: readonly { waypoints?: readonly unknown[] }[] }>(
  input: T,
) {
  return input.edges.some((e) => e.waypoints?.length) ? { ...input, geometry: await loadShapedRoutes() } : input;
}
