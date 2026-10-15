// Simulation goldens, shared by the sim-<k>.parity.ts files (each takes every third diagram, so the runs spread
// over workers). One golden per saved simulation and one for free play.
import { describe, it } from "vitest";
import { allDiagrams, shard } from "../lib/corpus";
import { expectGolden } from "../lib/golden";
import { play } from "../lib/sim";

export const SIM_SHARDS = 3;

export function simulationGoldens(k: number): void {
  for (const { slug, diagram } of shard(allDiagrams, k, SIM_SHARDS)) {
    describe(slug, () => {
      it("free play", () => expectGolden(`sim/${slug}/free-play.json`, play(diagram, null)));
      for (const simulation of diagram.simulations ?? [])
        it(simulation.id, () => expectGolden(`sim/${slug}/${simulation.id}.json`, play(diagram, simulation)));
    });
  }
}
