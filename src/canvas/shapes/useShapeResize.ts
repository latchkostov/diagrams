import { useCallback } from "react";
import { useStoreApi, type NodeChange } from "@xyflow/react";
import type { FlowNode } from "../types";
import { minSize } from "../annotations";
import { constrainShapeResize } from "./resize";

/** Shared by every annotation host, before its normal node-change handling. */
export function useShapeResize(apply: (changes: NodeChange<FlowNode>[]) => void) {
  const store = useStoreApi<FlowNode>();
  return useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      apply(constrainShapeResize(store.getState, changes, minSize.shape.width));
    },
    [apply, store],
  );
}
