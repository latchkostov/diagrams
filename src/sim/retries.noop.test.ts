import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { createSimulationRun } from "./simulation";
import { analyzeCapacity } from "./capacity";
import { createEngine, randomDraws } from "./engine";
import { waitingFixture } from "../lab/waitingFixture";

it("w2-noop keeps processing-failure replies byte-identical without retry fields, every tick", () => {
  const old = waitingFixture();
  old.nodes[2].stencil = "generic.service";
  old.nodes[2].props = { concurrency: 10, latencyMs: 30, jitter: 0, failureRate: 1 };
  const next = structuredClone(old);
  next.planning!.revision = "p3-w2";
  const a = createEngine({ seed: 7 }),
    b = createEngine({ seed: 7 });
  a.load(old);
  b.load(next);
  a.inject("source", 1);
  b.inject("source", 1);
  for (let i = 0; i < 100; i++) {
    a.step(10);
    b.step(10);
    expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(a.snapshot()));
  }
});

// Frozen harness-owned inputs; no example-directory traversal.
for (const file of readdirSync("tests/parity/corpus").filter((f) => f.endsWith(".diagram.json"))) {
  const diagram = JSON.parse(readFileSync(`tests/parity/corpus/${file}`, "utf8")) as DiagramFile;
  if (diagram.planning?.revision !== "p3-w1") continue;
  it(`w2-noop: ${file} relabels byte for byte`, () => {
    const next = structuredClone(diagram);
    next.planning!.revision = "p3-w2";
    expect(JSON.stringify(analyzeCapacity(next).nodes)).toBe(JSON.stringify(analyzeCapacity(diagram).nodes));
    expect(JSON.stringify(analyzeCapacity(next).connections)).toBe(
      JSON.stringify(analyzeCapacity(diagram).connections),
    );
    const oldFree = createEngine({ seed: 17 }),
      newFree = createEngine({ seed: 17 });
    oldFree.load(diagram);
    newFree.load(next);
    oldFree.setTraffic(true);
    newFree.setTraffic(true);
    for (let i = 0; i < 600; i++) {
      oldFree.step(100);
      newFree.step(100);
      expect(JSON.stringify(newFree.snapshot())).toBe(JSON.stringify(oldFree.snapshot()));
      expect(randomDraws(newFree)).toBe(randomDraws(oldFree));
    }
    for (const simulation of diagram.simulations ?? []) {
      const a = createSimulationRun(diagram, simulation);
      const b = createSimulationRun(next, simulation);
      while (!a.state().done) {
        a.step(100);
        b.step(100);
        expect(JSON.stringify(b.engine.snapshot())).toBe(JSON.stringify(a.engine.snapshot()));
        expect(randomDraws(b.engine)).toBe(randomDraws(a.engine));
      }
    }
  });
}
