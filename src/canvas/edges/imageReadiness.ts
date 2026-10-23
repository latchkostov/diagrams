import { flushSync } from "react-dom";
import { edgeGeometryPending } from "./readiness";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";

export function whenEdgeGeometryReady(root: Pick<ParentNode, "querySelector">): Promise<unknown> | undefined {
  if (!edgeGeometryPending(root)) return;
  return waitForEdges(root);
}

async function waitForEdges(root: Pick<ParentNode, "querySelector">): Promise<void> {
  do {
    await Promise.all([
      root.querySelector('[data-route-pending="shaped"]') && loadShapedRoutes(),
      root.querySelector('[data-route-pending="details"]') && loadEdgeDetails(),
    ]);
    // Geometry can replace its pending marker with a dependency-details marker.
    // Commit the external-store update, then allow a frame before checking again.
    flushSync(() => {});
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  } while (edgeGeometryPending(root));
}
