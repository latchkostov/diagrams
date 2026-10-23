import { loadOnce } from "../../lib/lazyLoad";
import { geometryChanged } from "../shapes/runtime";

export let edgeDetails: typeof import("./SettingsCard") | undefined;
export const loadEdgeDetails = loadOnce(async () => {
  edgeDetails = await import("./SettingsCard");
  geometryChanged();
  return edgeDetails;
});
