import { useState } from "react";
import { LiveController } from "../live/controller";
import { TraceCard } from "../live/TraceCard";
import type { TraceFlow } from "../live/TraceLab";
import { useSlowTraceCard } from "../live/session/useTraceSpotlight";
import { buildScript, frameAt, stepStop, PACING } from "../live/slowmo/script";
import { SlowMotion } from "../live/slowmo/session";
import type { SlowMotionView } from "../live/slowmo/useSlowMotion";
import { stencilRole } from "../stencils/roles";
import { traceOnce } from "../trace/headless";

const noop = () => {};

/** One mounted, paused replay: locale changes must refresh the card while slow.state keeps its identity. */
export function SlowTraceLocaleLab({ flow }: { flow: TraceFlow }) {
  const [slow] = useState<SlowMotionView>(() => {
    const trace = traceOnce(flow.diagram, { simulation: flow.simulation });
    if (!trace) throw new Error("The slow-motion locale fixture needs a finished trace");
    const session = new SlowMotion(new LiveController(flow.diagram), {
      build: () => script,
      code: { buildScript, frameAt, stepStop },
    });
    const script = buildScript({
      trace,
      diagram: flow.diagram,
      roleOf: (id) => stencilRole(flow.diagram.nodes.find((n) => n.id === id)!.stencil),
    });
    return {
      session,
      state: {
        ...session.getState(),
        status: "on",
        playing: false,
        trace,
        script: { ...script, unfinished: true, summary: "Still moving", duration: PACING.longScript + 1 },
      },
      end: noop,
      start: noop,
      frame: () => undefined,
      ui: noop,
      path: null,
    };
  });
  const card = useSlowTraceCard(slow)!;
  return (
    <div className="tr-lab-seq">
      <button
        data-testid="slow-trace-locale-pseudo"
        onClick={() => void import("../i18n/load").then((m) => m.chooseLocale("en-XA"))}
      >
        Pseudo-locale
      </button>
      <button
        data-testid="slow-trace-locale-en"
        onClick={() => void import("../i18n/load").then((m) => m.chooseLocale("en"))}
      >
        English
      </button>
      <div className="tr-lab-slot">
        <TraceCard
          trace={card.trace}
          slowmo={card.card}
          diagram={flow.diagram}
          now={slow.state.trace!.endedAt ?? 0}
          onClose={noop}
          onSequence={noop}
        />
      </div>
    </div>
  );
}
