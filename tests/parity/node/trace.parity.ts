// Message traces and what is built from them: the trace card's journey, the sequence diagram (its model, its Mermaid
// text and its SVG in both themes) and slow motion's script, for one message in free play and in each saved
// simulation (and the first dead letter, where there is one), as `traceOnce` records them.
import { describe, it } from "vitest";
import type { DiagramFile } from "../../../src/model/types";
import type { MessageTrace } from "../../../src/sim/types";
import { traceOnce } from "../../../src/trace/headless";
import { buildJourney } from "../../../src/trace/journey";
import { buildSequence } from "../../../src/trace/sequence";
import { toMermaid } from "../../../src/trace/mermaid";
import { SEQUENCE_THEMES, toSvg } from "../../../src/trace/svg";
import { buildScript } from "../../../src/live/slowmo/script";
import { stencilRole } from "../../../src/stencils/roles";
import { examples } from "../lib/corpus";
import { expectGolden, expectGoldenText } from "../lib/golden";
import { fingerprint } from "../lib/hash";

function derived(d: DiagramFile, trace: MessageTrace, name: string) {
  const journey = buildJourney(trace, d);
  const sequence = buildSequence(trace, d);
  const roles = new Map(d.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const roleOf = (id: string) => roles.get(id) ?? "none";
  const script = buildScript({ trace, diagram: d, roleOf });
  const reduced = buildScript({ trace, diagram: d, roleOf, reduced: true });
  expectGoldenText(`trace/${name}.mmd`, toMermaid(sequence, { times: true }));
  const svg = (theme: "light" | "dark") => {
    const layout = toSvg(sequence, SEQUENCE_THEMES[theme]);
    return {
      ...fingerprint(layout.svg),
      width: layout.width,
      height: layout.height,
      headerHeight: layout.headerHeight,
    };
  };
  const { rowOf, ...journeyRest } = journey;
  const { rowStart, ...scriptRest } = script;
  return {
    trace: { ...trace, steps: trace.steps.length },
    steps: trace.steps,
    journey: { ...journeyRest, rowOf: Object.fromEntries(rowOf) },
    sequence,
    mermaidPlain: toMermaid(sequence),
    svg: { light: svg("light"), dark: svg("dark") },
    slowMotion: { ...scriptRest, rowStart: Object.fromEntries(rowStart) },
    slowMotionReduced: { duration: reduced.duration, beats: reduced.beats.map((b) => [b.kind, b.start, b.duration]) },
  };
}

function traced(d: DiagramFile, name: string, trace: MessageTrace | undefined) {
  if (!trace) return expectGolden(`trace/${name}.json`, { trace: null });
  expectGolden(`trace/${name}.json`, derived(d, trace, name));
}

describe("traces", () => {
  for (const { slug, diagram } of examples) {
    it(`${slug} free play`, () => traced(diagram, `${slug}/free-play`, traceOnce(diagram)));
    for (const simulation of diagram.simulations ?? []) {
      it(`${slug} ${simulation.id}`, () =>
        traced(diagram, `${slug}/${simulation.id}`, traceOnce(diagram, { simulation })));
      it(`${slug} ${simulation.id} dead letter`, () =>
        traced(diagram, `${slug}/${simulation.id}.dead-letter`, traceOnce(diagram, { simulation, deadLetter: true })));
    }
  }
});
