import { loadFailed } from "../../lib/lazyLoad";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";

const required = new Set<() => Promise<unknown>>();
/** A surviving toast always retries every required edge module, across all edges. */
export function requireEdgeModules(shaped: boolean, details: boolean) {
  if (shaped) required.add(loadShapedRoutes);
  if (details) required.add(loadEdgeDetails);
  retryEdgeModules();
}
function retryEdgeModules() {
  void Promise.all([...required].map((load) => load())).catch(() => loadFailed(retryEdgeModules));
}
/** Shared by measurement transactions and image capture; missing routes are never settled. */
export const edgeGeometryPending = (root: Pick<ParentNode, "querySelector">) =>
  !!root.querySelector('[data-route-pending="true"]');
export async function whenEdgeGeometryReady(root: Pick<ParentNode, "querySelector">) {
  if (!edgeGeometryPending(root)) return;
  await Promise.all([
    root.querySelector('[data-route-module="shaped"]') && loadShapedRoutes(),
    root.querySelector('[data-route-module="details"]') && loadEdgeDetails(),
  ]);
}
