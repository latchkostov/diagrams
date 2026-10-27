import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { fuzzSeeds } from "../test/fuzzSeeds";

it("keeps overlapping Nightly dispatches and every matrix sibling", () => {
  const workflow = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  expect(workflow.concurrency).toBeUndefined();
  for (const job of Object.values(workflow.jobs) as { strategy?: { "fail-fast": boolean } }[])
    if (job.strategy) expect(job.strategy["fail-fast"]).toBe(false);
});

it("shards the full 20x property corpus with independent reports and a step deadline before the job deadline", () => {
  const { jobs } = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  const job = jobs.properties;
  expect(job.strategy?.matrix).toEqual({ shard: [1, 2, 3, 4], total: [4] });
  const run = job.steps.find((step: { run?: string }) => step.run?.includes("vitest run"));
  expect(run.env).toMatchObject({ FC_SEED: "random", FC_RUN_MULTIPLIER: "20" });
  expect(run.run).toContain("git grep -l");
  expect(run.run).toContain('--shard="$SHARD/$TOTAL"');
  expect(run.env).toMatchObject({ SHARD: "${{ matrix.shard }}", TOTAL: "${{ matrix.total }}" });
  expect(run["timeout-minutes"]).toBeGreaterThan(10);
  expect(run["timeout-minutes"] + 5).toBeLessThanOrEqual(job["timeout-minutes"]);
});

it("halves Linux E2E shard workloads without dropping repetitions, and retains reports after step timeouts", () => {
  const { jobs } = parse(readFileSync(".github/workflows/nightly.yml", "utf8"));
  const job = jobs.e2e;
  const entries = job.strategy.matrix.include as {
    suite: string;
    target: string;
    repeat: number;
    shard: number;
    total: number;
  }[];
  for (const [suite, target, repeat, total] of [
    ["dev", "dev", 1, 8],
    ["repeat", "build", 3, 12],
  ] as const) {
    expect(entries.filter((entry) => entry.suite === suite)).toEqual(
      Array.from({ length: total }, (_, i) => ({
        suite,
        label: suite === "dev" ? "Dev server" : "Build ×3",
        target,
        repeat,
        shard: i + 1,
        total,
      })),
    );
  }
  const run = job.steps.find((step: { uses?: string }) => step.uses === "./.github/actions/e2e");
  expect(run.with).toMatchObject({ retries: "0", "repeat-each": "${{ matrix.repeat }}" });
  expect(run["timeout-minutes"] + 5).toBeLessThanOrEqual(job["timeout-minutes"]);
  for (const id of ["properties", "e2e"]) {
    const uploads = jobs[id].steps.filter((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact"),
    );
    expect(uploads.every((step: { if: string }) => step.if === "always()")).toBe(true);
  }
});

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
