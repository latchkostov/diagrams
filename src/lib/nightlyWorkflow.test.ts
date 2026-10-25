import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { fuzzSeeds } from "../test/fuzzSeeds";

it("partitions all 5,000 resource seeds into small jobs within the existing runner backstop", () => {
  const workflow = parse(readFileSync(new URL("../../.github/workflows/nightly.yml", import.meta.url), "utf8")) as {
    jobs: Record<
      string,
      {
        "timeout-minutes": number;
        strategy: { "fail-fast": boolean; matrix: { shard: number[]; total: number[] } };
        steps: { run?: string; env?: Record<string, string> }[];
      }
    >;
  };
  const job = workflow.jobs["resource-invariants"];
  const { shard, total } = job.strategy.matrix;
  expect(job["timeout-minutes"]).toBe(10);
  expect(job.strategy["fail-fast"]).toBe(false);
  expect(total).toHaveLength(1);
  expect(shard).toEqual(Array.from({ length: total[0] }, (_, i) => i + 1));
  const step = job.steps.find((step) => step.run?.includes("autoscaling.invariants.heavy.test.ts"));
  expect(step?.env?.A1_FUZZ_NIGHTLY).toBe("1");
  expect(step?.env?.RESOURCE_FUZZ_SHARD).toBe("${{ matrix.shard }}/${{ matrix.total }}");
  for (const pinned of [[], [505, 1724]]) {
    const whole = fuzzSeeds(5000, undefined, undefined, pinned);
    const partitions = shard.map((i) => fuzzSeeds(5000, undefined, `${i}/${total[0]}`, pinned));
    expect(partitions.flat().sort((a, b) => a - b)).toEqual(whole);
    for (const partition of partitions) expect(partition.length).toBeLessThanOrEqual(Math.ceil(whole.length / 16));
  }
});
