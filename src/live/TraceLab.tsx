// Lab previews for the message trace: the trace card in each state, and the sequence diagram of a
// public example's flow. Traces come from the real engine (src/trace/headless.ts), so these are
// exactly what the live view would show.

import { useMemo, useState, type ReactNode } from "react";
import type { DiagramFile, Simulation } from "../model/types";
import type { MessageTrace } from "../sim/types";
import { useSettings } from "../harness/settings";
import { traceOnce } from "../trace/headless";
import { buildSequence } from "../trace/sequence";
import { toMermaid } from "../trace/mermaid";
import { SEQUENCE_THEMES, toSvg } from "../trace/svg";
import { TraceCard } from "./TraceCard";

export interface TraceFlow {
  diagram: DiagramFile;
  simulation?: Simulation;
  deadLetter?: boolean;
}

function useTrace(flow: TraceFlow): MessageTrace | undefined {
  return useMemo(
    () => traceOnce(flow.diagram, { simulation: flow.simulation, deadLetter: flow.deadLetter }),
    [flow.diagram, flow.simulation, flow.deadLetter],
  );
}

/** A finished trace cut back to its first `share` of steps: the same message, still in flight. */
function inFlight(trace: MessageTrace, share: number): MessageTrace {
  const steps = trace.steps.slice(0, Math.max(1, Math.round(trace.steps.length * share)));
  return { ...trace, steps, done: false, endedAt: undefined };
}

const noop = () => {};

/** Interactive fixture: switch equal-length journeys and append hops to exercise scroll-following. */
export function TraceCardInteraction({ flow }: { flow: TraceFlow }) {
  const original = useTrace(flow);
  const [root, setRoot] = useState(1);
  const [extra, setExtra] = useState(0);
  if (!original) return <p className="lab-note">No message finished its journey.</p>;
  const trace: MessageTrace = {
    ...original,
    rootId: root,
    steps: [
      ...original.steps,
      ...Array.from({ length: extra }, (_, i) => ({
        t: (original.endedAt ?? 0) + i * 100,
        kind: "arrive" as const,
        id: root,
        type: original.type,
        node: original.origin,
      })),
    ],
  };
  return (
    <div className="tr-lab-seq">
      <div>
        <button
          className="btn"
          data-testid="trace-lab-replace"
          onClick={() => {
            setRoot(root + 1);
            setExtra(0);
          }}
        >
          Replace message
        </button>
        <button className="btn" data-testid="trace-lab-append" onClick={() => setExtra(extra + 1)}>
          Append hop
        </button>
      </div>
      <div className="tr-lab-slot">
        <TraceCard
          trace={{ rootId: root, current: trace }}
          diagram={flow.diagram}
          now={trace.endedAt ?? 0}
          onClose={noop}
          onSequence={noop}
          room={320}
        />
      </div>
    </div>
  );
}

export function TraceCardStates({ flow, failing }: { flow: TraceFlow; failing: TraceFlow }) {
  const trace = useTrace(flow);
  const dead = useTrace(failing);
  if (!trace || !dead) return <p className="lab-note">No message finished its journey.</p>;
  const mid = inFlight(trace, 0.45);
  const states: { label: string; render: () => ReactNode }[] = [
    {
      label: "Waiting at a node",
      render: () => (
        <TraceCard
          trace={{ pending: { next: "message", node: trace.origin } }}
          diagram={flow.diagram}
          now={0}
          onClose={noop}
          onSequence={noop}
          onSendOne={noop}
        />
      ),
    },
    {
      label: "In flight",
      render: () => (
        <TraceCard
          trace={{ rootId: mid.rootId, current: mid }}
          diagram={flow.diagram}
          now={mid.steps.at(-1)!.t}
          onClose={noop}
          onSequence={noop}
        />
      ),
    },
    {
      label: "Done",
      render: () => (
        <TraceCard
          trace={{ rootId: trace.rootId, current: trace }}
          diagram={flow.diagram}
          now={trace.endedAt!}
          onClose={noop}
          onSequence={noop}
        />
      ),
    },
    {
      label: "Retried, then dead-lettered",
      render: () => (
        <TraceCard
          trace={{ rootId: dead.rootId, current: dead }}
          diagram={failing.diagram}
          now={dead.endedAt ?? 0}
          onClose={noop}
          onSequence={noop}
        />
      ),
    },
  ];
  return (
    <div className="tr-lab-states" data-testid="trace-lab-states">
      {states.map((s) => (
        <figure key={s.label} className="tr-lab-state">
          <figcaption>{s.label}</figcaption>
          <div className="tr-lab-slot">{s.render()}</div>
        </figure>
      ))}
    </div>
  );
}

export function TraceSequencePreview({ flow }: { flow: TraceFlow }) {
  const { theme } = useSettings();
  const trace = useTrace(flow);
  const model = useMemo(() => (trace ? buildSequence(trace, flow.diagram) : null), [trace, flow.diagram]);
  if (!model) return <p className="lab-note">No message finished its journey.</p>;
  const { svg } = toSvg(model, SEQUENCE_THEMES[theme]);
  return (
    <div className="tr-lab-seq" data-testid="trace-lab-sequence">
      <div
        className="tr-seq"
        data-testid="sequence-view"
        role="region"
        aria-label="Sequence diagram"
        // Scrollable both ways: keyboard users scroll it with the arrow keys.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        // Escaped by src/trace/svg.ts.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <details>
        <summary>Mermaid</summary>
        <pre className="mono" data-testid="trace-lab-mermaid">
          {toMermaid(model)}
        </pre>
      </details>
    </div>
  );
}
