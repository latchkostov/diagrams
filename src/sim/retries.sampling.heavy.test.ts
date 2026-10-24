import { it } from "vitest";
import { resilienceFixture } from "../lab/resilienceFixture";
import type { EdgeSimProps } from "./types";
import { constantRateRuns, expectScaleEquivalent } from "../test/scaleEquivalence";

for (const policy of ["fixed", "jitter", "budget"] as const)
  for (const scale of [2, 10])
    it(`I1 retry counters: ${policy} at scale ${scale}, five same-arrival seeds`, () => {
      const d = resilienceFixture();
      d.nodes[0].props!.ratePerSec = 0;
      const retry = (d.edges[1].props!.caller as EdgeSimProps["caller"])!.retry!;
      if (policy === "fixed") {
        retry.strategy = "fixed";
        retry.jitter = 0;
      }
      if (policy === "budget") retry.budget = { percent: 20, minPerSec: 10 };
      for (const seed of [1, 7, 17, 42, 99]) {
        const run = constantRateRuns(d, scale, { seed, durationMs: 15000 });
        expectScaleEquivalent(run.baseline, run.sampled, Math.min(...run.pools));
      }
    });
