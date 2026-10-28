import { surfaceCatalogs } from "../../i18n/surfaces";

// The inspector surfaces that render simulation words, each with the catalog they render: they arrive together, and
// share their surface's placeholder, failure and Retry (docs/I18N.md). A .ts module, so the component modules export
// only components (Fast Refresh).

const withSimulation = <M>(code: Promise<M>): Promise<M> =>
  Promise.all([code, surfaceCatalogs(["simulation"])]).then(([m]) => m);

export const loadNodeSimulation = () => withSimulation(import("./SimulationFields")).then((m) => m.NodeSimulation);
export const loadCallWaitFields = () => withSimulation(import("./CallWaitFields")).then((m) => m.CallWaitFields);
export const loadEdgePanel = () => withSimulation(import("./EdgePanel")).then((m) => m.EdgePanel);
export const loadMultiPanel = () => withSimulation(import("./MultiPanel")).then((m) => m.MultiPanel);
