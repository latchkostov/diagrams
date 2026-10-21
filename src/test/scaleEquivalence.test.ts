import fc from "fast-check";
import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "../sim/engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "../sim/resourceInvariants";
import { STEP } from "../sim/timing";
import { assertHarnessDriven, cohortArrivals, constantRateRuns, drive, sameArrivals } from "./scaleEquivalence";

it("injects exactly N real arrivals per integer cohort, at the same instant", () => {
  fc.assert(
    fc.property(
      fc.array(fc.nat({ max: 10 }), { maxLength: 100 }),
      fc.integer({ min: 1, max: 100 }),
      (cohorts, scale) => {
        expect(sameArrivals(cohorts, scale)).toEqual(cohorts.map((n) => n * scale));
      },
    ),
  );
});

it("keeps every cumulative real total equal to floor(C * N), including fractional cohorts", () => {
  fc.assert(
    fc.property(
      fc.array(fc.nat({ max: 10 }), { maxLength: 100 }),
      fc.integer({ min: 100, max: 1000 }),
      (cohorts, hundredths) => {
        const real = sameArrivals(cohorts, hundredths / 100);
        let c = 0,
          total = 0;
        cohorts.forEach((n, i) => {
          c += n;
          total += real[i];
          expect(total).toBe(Math.floor((c * hundredths) / 100));
          if (n === 0) expect(real[i]).toBe(0);
        });
      },
    ),
  );
});

it("does not lose an integer arrival to floating-point multiplication", () => {
  expect(sameArrivals([25, 0, 25], 1.16)).toEqual([29, 0, 29]);
});

it("records the original sampled arrival boundaries, including multi-cohort ticks", () => {
  expect(cohortArrivals(2, 100, 50)).toEqual([0, 1, 0, 1, 0]);
  expect(cohortArrivals(2.5, 1000, 30)).toEqual([4, 4, 4]);
});

it.each([1, 1.01, 1.1, 2, 2.5, 10])("leaves the sampled run byte-identical to the old harness at scale %s", (scale) => {
  const diagram = waitingFixture();
  const old = createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
    verifyResources: assertResourceInvariants,
  });
  old.load(diagram);
  let injected = 0;
  for (let time = STEP; time <= 20_000; time += STEP) {
    const due = Math.floor((time * 100) / (1000 * scale));
    if (due > injected) old.inject("source", due - injected);
    injected = due;
    old.step(STEP);
  }
  expect(JSON.stringify(constantRateRuns(diagram, scale).sampled)).toBe(JSON.stringify(old.snapshot()));
});

it("replays the same instants with the requested seed, rate and duration", () => {
  const diagram = waitingFixture();
  diagram.edges[1].props!.caller = { poolConnections: 3 };
  const runs = constantRateRuns(diagram, 2.5, { seed: 17, ratePerSec: 300, durationMs: 200 });
  expect(runs.cohorts).toEqual(cohortArrivals(2.5, 300, 200));
  expect(runs.real).toEqual(sameArrivals(runs.cohorts, 2.5));
  expect(runs.pools).toEqual([4, 3]);
  expect(JSON.stringify(runs.baseline)).toBe(JSON.stringify(drive(diagram, 1, runs.real, 17)));
});

it("rejects diagram-owned source rates and mixes before driving either run", () => {
  const diagram = waitingFixture();
  expect(() => assertHarnessDriven(diagram)).not.toThrow();
  diagram.nodes[0].props = { ratePerSec: 1 };
  expect(() => constantRateRuns(diagram, 2)).toThrow("I1 harness owns arrivals");
  diagram.nodes[0].props = { trafficMix: { mode: "shares", entries: [] } };
  expect(() => drive(diagram, 1, [1])).toThrow("I1 harness owns arrivals");
});
