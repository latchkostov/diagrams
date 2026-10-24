import { defineLazySurface } from "../lib/lazySurface";
import { LoadingPanel } from "./LoadingSimPanel";
import { useState, type ComponentProps } from "react";
import { domActive } from "../canvas/interaction";

// Authoring (including drill presets) is only needed once the simulation panel opens.
const LazySimPanel = defineLazySurface({
  id: "live.simulations",
  load: () => import("./SimPanel").then((m) => m.SimPanel),
  placeholder: {
    size: {},
    testId: "live.simulations-loading",
    render: ({ onClose, opener }, status) => <LoadingPanel onClose={onClose} opener={opener} {...status} />,
  },
  focus: {},
  export: "skip",
  retryToast: true,
});

export function SimPanel(props: ComponentProps<typeof LazySimPanel>) {
  // This wrapper survives the placeholder -> loaded handoff.
  const [opener] = useState(domActive);
  return <LazySimPanel {...props} opener={opener} />;
}
SimPanel.preload = LazySimPanel.preload;
