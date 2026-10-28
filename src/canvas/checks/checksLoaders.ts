import { surfaceCatalogs } from "../../i18n/surfaces";

// Findings, fixes and markers read planning, thread and broker words: their code and the simulation catalog arrive
// together, and share the surface's failure and Retry (docs/I18N.md). A loader-only module: what it declares covers
// exactly what it loads.

const withSimulation = <M>(code: Promise<M>): Promise<M> =>
  Promise.all([code, surfaceCatalogs(["simulation"])]).then(([m]) => m);

export const loadChecksUi = () => withSimulation(import("../../checks/ui/ChecksCard"));
export const loadChecksMarkers = () => withSimulation(import("./ChecksMarkers")).then((m) => m.ChecksMarkers);
