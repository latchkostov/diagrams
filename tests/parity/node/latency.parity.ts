import { it } from "vitest";
import { createSimulationRun } from "../../../src/sim/simulation";
import { examples } from "../lib/corpus";
import { expectGolden } from "../lib/golden";

const showcase = examples.find((e) => e.slug === "where-the-time-goes");
if (!showcase) throw new Error("Missing latency showcase");
const { diagram } = showcase;
for (const simulation of diagram.simulations ?? []) {
  it(`sampled latency: ${simulation.id}`, () => {
    const run = createSimulationRun(diagram, simulation);
    const points = [];
    while (!run.state().done) {
      run.step(200);
      const frame = run.engine.frame();
      points.push({ time: frame.time, billing: frame.nodes.billing.latency, receipts: frame.nodes.receipts.latency });
    }
    expectGolden(`latency/where-the-time-goes/${simulation.id}.json`, points);
  });
}
