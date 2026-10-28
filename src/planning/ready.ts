import { surfaceCatalogs } from "../i18n/surfaces";
export async function planningWhenReady() {
  await surfaceCatalogs(["simulation"]);
}
