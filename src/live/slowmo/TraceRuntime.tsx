// eslint-disable-next-line react-refresh/only-export-components
export { loadSlowScript as prepareRuntime } from "./scriptChunk";
import { useLayoutEffect } from "react";
import { buildJourney } from "../../trace/journey";
import type { TraceFacade } from "../session/traceFacade";
import type { SlowMotionOptions } from "./controller";
import { useSlowMotion } from "./useSlowMotion";
import { useSlowTraceCard } from "./traceCard";

export interface TraceRuntimeProps extends SlowMotionOptions {
  facade: TraceFacade;
}

/** A normal React adapter: hooks never cross an asynchronous call boundary. */
export function TraceRuntime({ facade, ...options }: TraceRuntimeProps) {
  const slow = useSlowMotion(options);
  const card = useSlowTraceCard(slow);
  useLayoutEffect(() => {
    facade.attach({
      slow,
      card,
      journey(trace, diagram) {
        const journey = buildJourney(trace, diagram);
        return { nodes: new Set(journey.nodes), edges: new Set(journey.edges) };
      },
    });
    // The view's commands are stable; only its published snapshot/path change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facade, slow.state, slow.path, card]);
  useLayoutEffect(() => () => facade.detach(), [facade]);
  return null;
}
