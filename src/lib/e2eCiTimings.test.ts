import { expect, it } from "vitest";
import { ciTimings, compareTimings } from "../../scripts/ci/e2e-timings.mjs";

function run(buildSeconds: number, shardSeconds: number) {
  const at = (second: number) => new Date(Date.UTC(2026, 9, 24, 0, 0, second)).toISOString();
  const job = (name: string, start: number, end: number) => ({
    name,
    status: "completed",
    conclusion: "success",
    started_at: at(start),
    completed_at: at(end),
  });
  return {
    jobs: [
      job("Detect changes", 0, 2),
      ...Array.from({ length: 6 }, (_, i) => job(`E2E ${i + 1}/6`, 2 + buildSeconds, 2 + buildSeconds + shardSeconds)),
      job("CI", 2 + buildSeconds + shardSeconds, 3 + buildSeconds + shardSeconds),
    ],
  };
}

it("includes the shared build and scheduling delay in the E2E critical path", () => {
  const after = run(60, 120);
  expect(ciTimings(after).map((row) => row.seconds)).toEqual([120, 120, 120, 120, 120, 120, 180, 183]);
  expect(compareTimings(run(0, 240), after)).toContain("| E2E 1/6 | 4m 0s | 2m 0s | -50.0% |");
  expect(compareTimings(run(0, 240), after)).toContain("| 4m 0s | 3m 0s | -25.0% |");
});

it("refuses misleading comparisons of failed, skipped, or incomplete CI runs", () => {
  for (const conclusion of ["failure", "cancelled", "skipped", ""]) {
    const report = run(0, 240);
    report.jobs[1].conclusion = conclusion;
    expect(() => ciTimings(report)).toThrow("six successful");
  }
  const report = run(0, 240);
  report.jobs.pop();
  expect(() => ciTimings(report)).toThrow("CI gate");
});
