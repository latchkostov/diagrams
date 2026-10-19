import { ledgerFixture } from "../lab/ledgerFixture";
import type { createEngine } from "../sim/engine";

const sampledCases = [
  { name: "reply-during-pause", scale: 10, nested: false, pause: 10, resume: 610, until: 6000, count: 5 },
  { name: "nested-reply-during-pause", scale: 10, nested: true, pause: 150, resume: 1350, until: 8000, count: 5 },
  { name: "reply-deadline-during-pause", scale: 10, nested: false, pause: 10, resume: 2000, until: 6000, count: 5 },
  { name: "retired-before-pause", scale: 10, nested: false, pause: 150, resume: 2150, until: 6000, count: 5 },
  ...[1.01, 1.1, 1.5].map((scale) => ({
    name: `fractional-${scale}`,
    scale,
    nested: false,
    pause: -1,
    resume: -1,
    until: 10_000,
    count: 200,
  })),
  { name: "fractional-nested-pause", scale: 1.5, nested: true, pause: 30, resume: 130, until: 4000, count: 10 },
];
export const ledgerTraceCases = [
  ...sampledCases,
  ...sampledCases.map((scenario) => ({ ...scenario, name: `scale-1-${scenario.name}`, scale: 1 })),
];

export function ledgerTrace(factory: typeof createEngine, scenario: (typeof ledgerTraceCases)[number]) {
  const diagram = ledgerFixture(scenario.nested);
  if (scenario.scale < 2) diagram.edges[1].props!.caller = { poolConnections: 2, wait: "non-blocking" };
  const engine = factory({ seed: 7, scale: scenario.scale, maxParticles: 0 });
  engine.load(diagram);
  engine.inject("caller", scenario.count);
  const trace: [time: number, delivered: number[], processed: number[], inSystem: number][] = [];
  let previous = "";
  for (let time = 0; time < 200_000; time += 10) {
    if (time === scenario.pause) engine.setNodeStatus("caller", "paused");
    if (time === scenario.resume) engine.setNodeStatus("caller", "up");
    engine.step(10);
    const snapshot = engine.snapshot();
    const state = {
      // Record deliveries and completions at every internal tick, without smoothed rates.
      delivered: Object.values(snapshot.edges).map((edge) => edge.delivered),
      processed: Object.values(snapshot.nodes).map((node) => node.processed),
      inSystem: snapshot.inSystem,
    };
    const value = JSON.stringify(state);
    if (value !== previous) trace.push([snapshot.time, state.delivered, state.processed, state.inSystem]);
    previous = value;
    if (time >= scenario.until && !snapshot.inSystem) return trace;
  }
  throw new Error(`Differential trace did not finish: ${scenario.name}`);
}
