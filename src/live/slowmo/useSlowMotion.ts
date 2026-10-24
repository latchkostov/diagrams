import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createSlowMotionView, type SlowMotionOptions, type SlowMotionView } from "./controller";
export type { SlowMotionView } from "./controller";

/** React renders snapshots and attaches the controller; lifecycle decisions run synchronously in the machine. */
export function useSlowMotion(opts: SlowMotionOptions): SlowMotionView {
  const [view] = useState(() => createSlowMotionView(opts));
  useLayoutEffect(() => view.connect(), [view]);
  useLayoutEffect(() => {
    view.update(opts);
  });
  const state = useSyncExternalStore(view.session.subscribe, view.session.getState, view.session.getState);
  const script = state.script;
  const path = useMemo(
    () => (script ? { nodes: new Set(script.nodes), edges: new Set(script.edges) } : null),
    [script],
  );
  return { ...view, state, path };
}
