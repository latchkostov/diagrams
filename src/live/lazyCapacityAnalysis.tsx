import { useMemo, useSyncExternalStore } from "react";
import { defineLazySurface } from "../lib/lazySurface";
import type { ElementHandle } from "../canvas/interaction/types";
import type { capacityView } from "./capacityView";
import { LoadingCapacity } from "./LoadingCapacity";

let compute: typeof capacityView | undefined;
export const CapacityAnalysis = defineLazySurface({
  id: "live.capacity-analysis",
  load: () =>
    import("./CapacityAnalysis").then((m) => {
      compute = m.CapacityAnalysis.compute;
      return m.CapacityAnalysis;
    }),
  placeholder: {
    size: {},
    testId: "live.capacity-analysis-loading",
    render: (props: { panel: boolean; onClose(): void; opener?: ElementHandle | null }, status) =>
      props.panel ? <LoadingCapacity onClose={props.onClose} opener={props.opener} {...status} /> : null,
  },
  focus: {},
  export: "await",
  retryToast: true,
});

export function useCapacityAnalysis(enabled: boolean, args: Parameters<typeof capacityView>, locale: string) {
  const state = useSyncExternalStore(CapacityAnalysis.subscribe, CapacityAnalysis.getSnapshot);
  const [diagram, simulation, status, replicas] = args;
  return useMemo(
    () => ({
      locale,
      value: enabled && state.value === "loaded" && compute ? compute(diagram, simulation, status, replicas) : null,
    }),
    [enabled, state, diagram, simulation, status, replicas, locale],
  ).value;
}
