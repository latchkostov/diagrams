import { it } from "vitest";
import { createSimulationRun } from "../../../src/sim/simulation";
import { corpus } from "../lib/corpus";
import { expectGolden } from "../lib/golden";

for (const { slug, diagram } of corpus.filter((entry) => /^w[12]-/.test(entry.slug))) {
  for (const simulation of diagram.simulations ?? []) {
    it(`${slug}: ${simulation.id} held slots and logical replies`, () => {
      const run = createSimulationRun(diagram, simulation);
      const points = [];
      while (!run.state().done) {
        run.step(100);
        const snapshot = run.engine.snapshot();
        points.push({
          time: snapshot.time,
          inSystem: snapshot.inSystem,
          nodes: Object.fromEntries(
            Object.entries(snapshot.nodes).map(([id, n]) => [
              id,
              {
                threads: n.threads,
                processed: n.processed,
                failed: n.failed,
                backlog: n.backlog,
                inFlight: n.inFlight,
                fleet: n.fleet,
                resources: n.resources,
              },
            ]),
          ),
          calls: Object.fromEntries(
            Object.entries(snapshot.edges)
              .filter(([, e]) => e.calls)
              .map(([id, e]) => [id, e.calls]),
          ),
        });
      }
      expectGolden(`waits/${slug}/${simulation.id}.json`, points);
    });
  }
}
