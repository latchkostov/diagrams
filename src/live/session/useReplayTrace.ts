import { useCallback } from "react";
import type { LiveController } from "../controller";
import type { SlowMotionView } from "../slowmo/controller";

/** Registry commands read the latest trace when invoked, without changing on Live publications. */
export function useReplayTrace(controller: LiveController, slow: SlowMotionView) {
  return useCallback(() => {
    const trace = controller.getState().trace;
    slow.start(trace?.rootId !== undefined ? { kind: "root", rootId: trace.rootId } : { kind: "followed" });
  }, [controller, slow]);
}
