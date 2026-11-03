import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { analyzeCapacity } from "./capacity";
import { createEngine, randomDraws } from "./engine";
import { createSimulationRun } from "./simulation";
import frozenBlackFriday from "../../tests/parity/fixtures/black-friday-commerce-a1.json";

const inputs = (dir: string, suffix: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => ({
      name: entry.name,
      diagram: JSON.parse(readFileSync(`${dir}/${entry.name}`, "utf8")) as DiagramFile,
    }));

for (const { name, diagram } of [
  ...inputs("tests/parity/corpus", ".diagram.json").filter(
    ({ diagram }) => diagram.planning?.revision === "p3-w1" || diagram.planning?.revision === "p3-w2",
  ),
  ...inputs("src/examples", ".json"),
  { name: "black-friday-commerce-a1.json", diagram: frozenBlackFriday as DiagramFile },
]) {
  const old = structuredClone(diagram);
  // W3's no-cache contract also covers new caching showcases with their policies
  // removed. The frozen pre-cache cohort above keeps every original tick covered.
  for (const node of old.nodes) delete node.props?.cache;
  for (const simulation of old.simulations ?? []) {
    for (const props of Object.values(simulation.setup?.props ?? {})) delete props.cache;
    for (const step of simulation.timeline ?? []) if (step.action.do === "props") delete step.action.props.cache;
  }
  // Keep the W1/W2 corpus as authored. Older public examples also exercise
  // their W2 interpretation; their original revisions remain pinned by parity.
  old.planning = { ...old.planning, revision: old.planning?.revision === "p3-w1" ? "p3-w1" : "p3-w2" };
  const next = structuredClone(old);
  next.planning!.revision = "p3-w3";
  it(`w3-noop: ${name}, analysis and free play`, () => {
    const a = analyzeCapacity(old),
      b = analyzeCapacity(next);
    expect(b.nodes).toEqual(a.nodes);
    expect(b.connections).toEqual(a.connections);
    expect(b.routeDemand).toEqual(a.routeDemand);
    // Retain a visible drawing sample in every free-play tick comparison.
    const x = createEngine({ seed: 17, maxParticles: 8 }),
      y = createEngine({ seed: 17, maxParticles: 8 });
    x.load(old);
    y.load(next);
    x.setTraffic(true);
    y.setTraffic(true);
    for (let tick = 0; tick < 1000; tick++) {
      x.step(10);
      y.step(10);
      expect(JSON.stringify(y.snapshot())).toBe(JSON.stringify(x.snapshot()));
      expect(randomDraws(y)).toBe(randomDraws(x));
    }
  });
  // Every saved run retains every tick and field comparison, with its own hang backstop.
  for (const simulation of old.simulations ?? []) {
    it(`w3-noop: ${name}, saved simulation ${simulation.id}`, () => {
      const first = createSimulationRun(old, simulation),
        second = createSimulationRun(next, simulation);
      while (!first.state().done) {
        if (first.state().waiting) {
          first.resume();
          second.resume();
        }
        first.step(10);
        second.step(10);
        expect(JSON.stringify(second.engine.snapshot())).toBe(JSON.stringify(first.engine.snapshot()));
        expect(randomDraws(second.engine)).toBe(randomDraws(first.engine));
      }
    });
  }
}
