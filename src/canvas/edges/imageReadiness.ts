import { edgeGeometryPending } from "./readiness";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";

export function whenEdgeGeometryReady(root: Pick<ParentNode, "querySelector">): Promise<unknown> | undefined {
  if (!edgeGeometryPending(root)) return;
  return Promise.all([
    root.querySelector('[data-route-pending="shaped"]') && loadShapedRoutes(),
    root.querySelector('[data-route-pending="details"]') && loadEdgeDetails(),
  ]);
}
