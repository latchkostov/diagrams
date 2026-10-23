import { loadOnce } from "../../lib/lazyLoad";
import { geometryChanged } from "../shapes/runtime";

export let routeGeometry: typeof import("./shaped") | undefined;
export const loadShapedRoutes = loadOnce(async () => {
  routeGeometry = await import("./shaped");
  geometryChanged();
});
