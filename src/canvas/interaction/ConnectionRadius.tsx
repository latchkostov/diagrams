import { useLayoutEffect } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
import { connectionRadius } from "../gestures";

/** Zoom affects connection snapping without subscribing the canvas shell or read-only viewers. */
export function ConnectionRadius() {
  const radius = useStore((state) => connectionRadius(state.transform[2]));
  const store = useStoreApi();
  useLayoutEffect(() => {
    store.setState({ connectionRadius: radius });
  }, [radius, store]);
  return null;
}
