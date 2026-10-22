import fc from "fast-check";
import { expect, it } from "vitest";
import { arbResilienceDiagram } from "../test/resilienceScenarios";
import { propertyRuns } from "../test/fastCheck";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";

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

const transition = fc.record({
  tier: fc.nat({ max: 3 }),
  status: fc.constantFrom("paused" as const, "down" as const, "up" as const, "shrink" as const),
  ticks: fc.integer({ min: 1, max: 40 }),
});

it("every reply is classified by its own attempt across pause, outage, drain and replay, under selective policies", () => {
  fc.assert(
    fc.property(
      arbResilienceDiagram,
      fc.subarray(["throttled", "transient", "timeout"] as const, { minLength: 1 }),
      fc.array(transition, { maxLength: 8 }),
      ({ diagram, scale }, retryOn, transitions) => {
        for (const edge of diagram.edges) {
          const caller = edge.props?.caller as import("./types").EdgeSimProps["caller"];
          if (caller?.retry) caller.retry = { ...caller.retry, retryOn: [...retryOn] };
        }
        const tiers = diagram.nodes.filter((n) => n.id.startsWith("tier")).map((n) => n.id);
        // verifyResilience also makes a reply that disagrees with its attempt's cause throw.
        const e = createEngine({
          seed: 7,
          scale,
          maxParticles: 0,
          verifyResilience: assertResilienceInvariants,
          verifyLedger: assertLedgerInvariants,
          verifyOutcomes: assertOutcomeInvariants,
        });
        const apply = (from: number, to: number) => {
          for (const { tier, status, ticks } of transitions.slice(from, to)) {
            const id = tiers[tier % tiers.length];
            if (status === "shrink") e.setNodeProps(id, { replicas: 1 });
            else e.setNodeStatus(id, status);
            e.step(ticks * 10);
          }
        };
        const finish = () => {
          apply(half, transitions.length);
          for (const id of tiers) e.setNodeStatus(id, "up");
          // Timeouts don't cancel work, so a storm across layers may still be draining; R6 checks it once idle.
          e.step(120_000);
          return e.snapshot();
        };
        const half = transitions.length >> 1;
        e.load(diagram);
        e.inject("source", 4);
        apply(0, half);
        const cp = e.checkpoint();
        const expected = finish();
        e.restore(cp);
        expect(finish()).toEqual(expected);
      },
    ),
    { numRuns: propertyRuns(30) },
  );
});
