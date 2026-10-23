import { useLayoutEffect } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { connectionRadius } from "../gestures";
import { publishFlowProbe } from "./flowProbe";

/**
 * Zoom affects connection snapping without subscribing the canvas shell or read-only viewers. In e2e builds it also
 * publishes the store probe (flowProbe.ts) that tests read the radius and viewport through.
 */
export function ConnectionRadius() {
  const radius = useStore((state) => connectionRadius(state.transform[2]));
  const store = useStoreApi();
  useLayoutEffect(() => {
    store.setState({ connectionRadius: radius });
  }, [radius, store]);
  useLayoutEffect(() => publishFlowProbe?.(store), [store]);
  return null;
}
