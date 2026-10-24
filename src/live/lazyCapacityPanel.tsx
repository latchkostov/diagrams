import { LoadingCapacity } from "./LoadingCapacity";
import { CapacityAnalysis } from "./lazyCapacityAnalysis";
import type { CapacityView } from "./capacityModel";
import { defineLazySurface } from "../lib/lazySurface";
import { useEffect, useState, type ComponentProps } from "react";
import { domActive } from "../canvas/interaction";

const LazyCapacityPanel = defineLazySurface({
  id: "live.capacity",
  load: () => import("./CapacityPanel").then((m) => m.CapacityPanel),
  placeholder: {
    render: (props, status) => <LoadingCapacity onClose={props.onClose} opener={props.opener} {...status} />,
  },
  focus: {},
  export: "skip",
  retryToast: true,
});

export function CapacityPanel(
  props: Omit<ComponentProps<typeof LazyCapacityPanel>, "view"> & { view: CapacityView | null },
) {
  const [opener] = useState(domActive);
  useEffect(() => LazyCapacityPanel.preload(), []);
  return props.view ? (
    <LazyCapacityPanel {...props} view={props.view} opener={opener} />
  ) : (
    <CapacityAnalysis panel onClose={props.onClose} opener={opener} />
  );
}
CapacityPanel.preload = LazyCapacityPanel.preload;
