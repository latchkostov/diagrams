import { useEffect, useLayoutEffect } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { connectionRadius } from "../gestures";
import { publishFlowProbe } from "./flowProbe";
import { requestDots } from "./connectDots";
import { whenIdle } from "../../lib/lazyLoad";

/**
 * Zoom affects connection snapping without subscribing the canvas shell or read-only viewers. In e2e builds it also
 * publishes the store probe (flowProbe.ts) that tests read the radius and viewport through; and it starts the dots'
 * resolver's download.
 */
export function ConnectionRadius() {
  const radius = useStore((state) => connectionRadius(state.transform[2]));
  const store = useStoreApi();
  useLayoutEffect(() => {
    store.setState({ connectionRadius: radius });
  }, [radius, store]);
  useLayoutEffect(() => publishFlowProbe?.(store), [store]);
  // The dots' resolver, once the editable canvas is up (connectDots.ts): ready before the first connection.
  useEffect(() => whenIdle(() => requestDots(), 0), []);
  return null;
}
