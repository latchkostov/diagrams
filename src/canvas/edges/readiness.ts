import { loadFailed } from "../../lib/lazyLoad";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";

let needsShaped = false;
let needsDetails = false;
/** A surviving toast always retries every required edge module, across all edges. */
export function requireEdgeModules(shaped: boolean, details: boolean) {
  needsShaped ||= shaped;
  needsDetails ||= details;
  retryEdgeModules();
}
function retryEdgeModules() {
  void Promise.all([needsShaped && loadShapedRoutes(), needsDetails && loadEdgeDetails()]).catch(() =>
    loadFailed(retryEdgeModules),
  );
}
/** Shared by measurement transactions and image capture; missing routes are never settled. */
export const edgeGeometryPending = (root: Pick<ParentNode, "querySelector">) =>
  !!root.querySelector("[data-route-pending]");
