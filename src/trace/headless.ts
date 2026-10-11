// Trace one message without the live view: for the Lab's sequence presets and for tests. Runs the
// same engine (or a saved simulation) to the point where the followed message is done.

import { flowEdges } from "../model/relations";
import type { DiagramFile, SimRole, Simulation } from "../model/types";
import { createEngine } from "../sim/engine";
import { createSimulationRun } from "../sim/simulation";
import type { MessageTrace, SimEngine } from "../sim/types";
import { stencilRole } from "../stencils/roles";

export interface TraceOnceOptions {
  /** Replay this saved simulation instead of injecting one message. */
  simulation?: Simulation;
  /** Where to start following (free play injects one message there). Default: the first entry point. */
  from?: string;
  /** Follow the first message to dead-letter instead. */
  deadLetter?: boolean;
  /** Give up after this much simulated time. Default 120 s. */
  maxMs?: number;
  seed?: number;
  roleOf?: (stencilId: string) => SimRole;
}

/** The diagram's entry point: a source, else the first node nothing points at. */
export function entryNode(diagram: DiagramFile, roleOf = stencilRole): string | undefined {
  const edges = flowEdges(diagram.edges);
  const targets = new Set(edges.map((e) => e.to));
  return (
    diagram.nodes.find((n) => roleOf(n.stencil) === "source" && edges.some((e) => e.from === n.id))?.id ??
    diagram.nodes.find((n) => !targets.has(n.id) && edges.some((e) => e.from === n.id))?.id
  );
}

export function traceOnce(diagram: DiagramFile, opts: TraceOnceOptions = {}): MessageTrace | undefined {
  const roleOf = opts.roleOf ?? stencilRole;
  const maxMs = opts.maxMs ?? 120_000;
  let engine: SimEngine;
  let step: (ms: number) => void;
  const from = opts.from ?? (opts.simulation ? undefined : entryNode(diagram, roleOf));
  if (opts.simulation) {
    const run = createSimulationRun(diagram, opts.simulation, { roleOf, seed: opts.seed, traceHistory: 256 });
    engine = run.engine;
    step = (ms) => {
      if (run.state().waiting) run.resume();
      run.step(ms);
    };
  } else {
    engine = createEngine({ roleOf, seed: opts.seed ?? 7, traceHistory: 256 });
    engine.load(diagram);
    step = (ms) => engine.step(ms);
  }
  engine.tracer.request(opts.deadLetter ? { next: "deadletter" } : { next: "message", node: from });
  if (!opts.simulation && from) engine.inject(from, 1);
  for (let t = 0; t < maxMs; t += 50) {
    step(50);
    if (engine.tracer.current()?.done) break;
  }
  return engine.tracer.current();
}
