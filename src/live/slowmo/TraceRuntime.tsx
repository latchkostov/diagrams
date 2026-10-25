// eslint-disable-next-line react-refresh/only-export-components
export { loadSlowScript as prepareRuntime } from "./scriptChunk";
import { useLayoutEffect } from "react";
import { buildJourney } from "../../trace/journey";
import type { TraceFacade } from "../session/traceFacade";
import type { SlowMotionOptions } from "./controller";
import { useSlowMotion } from "./useSlowMotion";
import { useSlowTraceCard } from "./traceCard";
import { TraceCard } from "../lazyTraceCard";
import type { MessageTrace } from "../../sim/types";

export interface TraceRuntimeProps extends SlowMotionOptions {
  facade: TraceFacade;
  cardRoom: number;
  onSequence(trace: MessageTrace): void;
}

/** A normal React adapter: hooks never cross an asynchronous call boundary. */
export function TraceRuntime({ facade, cardRoom, onSequence, ...options }: TraceRuntimeProps) {
  const slow = useSlowMotion(options);
  const card = useSlowTraceCard(slow);
  useLayoutEffect(() => {
    facade.attach({
      slow,
      journey(trace, diagram) {
        const journey = buildJourney(trace, diagram);
        return { nodes: new Set(journey.nodes), edges: new Set(journey.edges) };
      },
    });
    // The view's commands are stable; only its published snapshot/path change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facade, slow.state, slow.path]);
  useLayoutEffect(() => () => facade.detach(), [facade]);
  if (!card || options.capturing) return null;
  return (
    <TraceCard
      trace={card.trace}
      diagram={options.controller.currentDiagram}
      now={card.trace.current?.endedAt ?? options.controller.getState().snapshot.time}
      onClose={facade.slow.end}
      onSequence={() => card.trace.current && onSequence(card.trace.current)}
      room={cardRoom}
      slowmo={card.card}
    />
  );
}
