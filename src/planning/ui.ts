import { surfaceCatalogs } from "../i18n/surfaces";

export { NodePlanning } from "./NodePlanning";
export { PlanningUpgrade } from "./PlanningUpgrade";
export { AdmissionFields, BulkAdmissionFields } from "./AdmissionFields";

export { AutoscalingFields } from "./AutoscalingFields";
export { RouteTableFields, TrafficMixFields, EdgeRouteFields, RequestRoutesSection } from "./RoutingFields";

/** Every planning control renders after this: the module that loads them declares their catalogs (docs/I18N.md). */
export async function planningWhenReady() {
  await surfaceCatalogs(["simulation"]);
}
