import { lazyComponent } from "../lib/lazyLoad";
import { LoadingPanel } from "./LoadingSimPanel";
import { useState, type ComponentProps } from "react";
import { domActive } from "../canvas/interaction";

// Authoring (including drill presets) is only needed once the simulation panel opens.
const LazySimPanel = lazyComponent(
  () => import("./SimPanel").then((m) => m.SimPanel),
  ({ onClose, opener }, status) => <LoadingPanel onClose={onClose} opener={opener} {...status} />,
);

export function SimPanel(props: ComponentProps<typeof LazySimPanel>) {
  // This wrapper survives the placeholder -> loaded handoff.
  const [opener] = useState(domActive);
  return <LazySimPanel {...props} opener={opener} />;
}
SimPanel.preload = LazySimPanel.preload;
