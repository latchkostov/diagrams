import { lazyComponent } from "../lib/lazyLoad";
import { LoadingPanel } from "./LoadingSimPanel";

// Authoring (including drill presets) is only needed once the simulation panel opens.
export const SimPanel = lazyComponent(
  () => import("./SimPanel").then((m) => m.SimPanel),
  ({ onClose }, status) => <LoadingPanel onClose={onClose} {...status} />,
);
