import fc from "fast-check";
import { expect, it } from "vitest";
import { arbResilienceDiagram } from "../test/resilienceScenarios";
import { propertyRuns } from "../test/fastCheck";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants } from "./resourceInvariants";

it("R1, R2, R5, R6 survive sampled branches, budgets, pools, failures, outage and checkpoint replay", () => {
  fc.assert(
    fc.property(arbResilienceDiagram, ({ diagram, scale }) => {
      const e = createEngine({
        seed: 7,
        scale,
        maxParticles: 0,
        verifyResilience: assertResilienceInvariants,
        verifyLedger: assertLedgerInvariants,
      });
      e.load(diagram);
      e.inject("source", 4);
      e.step(500);
      const cp = e.checkpoint();
      const advance = () => {
        e.setNodeStatus("side", "down");
        e.step(1000);
        e.setNodeStatus("side", "up");
        e.step(30000);
        return e.snapshot();
      };
      const expected = advance();
      e.restore(cp);
      expect(advance()).toEqual(expected);
      expect(e.snapshot().edges).toEqual(expected.edges);
    }),
    { numRuns: propertyRuns(30) },
  );
});
