import { expect, it } from "vitest";
import { failedTests, renderReport, type Snapshot } from "../../scripts/ci/flake-report.mjs";

const failure = (line = 14, decoration = "") =>
  `[chromium] › tests/e2e/example.spec.ts:${line}:1 › suite › test${decoration}`;

it("deduplicates annotations and summaries across line changes and reporter decoration", () => {
  const tests = failedTests(
    `2026-10-24T01:00:00Z ##[error]  1) ${failure()}\n  1) \x1b[31m${failure(26, " ─────")}\x1b[0m\n${failure()}\n| 5 | slow.spec.ts | passed |\n2026-10-24T01:00:00Z [1/10] [chromium] › tests/e2e/passed.spec.ts:1:1 › passed`,
  );
  expect(tests).toEqual([
    {
      id: "[chromium] tests/e2e/example.spec.ts › suite › test",
      project: "chromium",
      file: "tests/e2e/example.spec.ts",
      title: "suite › test",
    },
  ]);
});

function snapshot(): Snapshot {
  const run = (databaseId: number, headSha: string, headBranch = "branch") => ({
    databaseId,
    headSha,
    headBranch,
    conclusion: "success",
    attempt: 1,
    createdAt: "2026-10-24T00:00:00Z",
    status: "completed",
  });
  const job = (id: number, runId: number, conclusion: string, start: number, end: number, attempt = 1) => ({
    id,
    runId,
    conclusion,
    attempt,
    name: "E2E 1/1",
    started_at: new Date(start * 1000).toISOString(),
    completed_at: new Date(end * 1000).toISOString(),
  });
  return {
    repo: "owner/repo",
    runs: [run(3, "different"), run(2, "sha", "other-branch"), { ...run(1, "sha"), attempt: 2 }],
    jobs: [
      job(10, 1, "failure", 0, 10),
      job(11, 1, "cancelled", 10, 20, 2),
      job(20, 2, "success", 30, 50),
      job(30, 3, "success", 50, 70),
    ],
    logs: { 10: failure(), 11: failure(30) },
    budgetSeconds: 60,
    unavailable: [],
  };
}

it("keeps failures before cancellation and recognizes later same-SHA shards across runs/attempts", () => {
  const data = snapshot();
  const report = renderReport(data);
  expect(report).toContain("suite › test | 2 | branch | 2/2 | E2E 1/1");
  expect(report).toContain("| E2E 1/1 | 3 | 16.7 | 20.0 | 27.8% | 100.0% |");
  expect(report).toContain("Run 3, SHA different");
  expect(renderReport(JSON.parse(JSON.stringify(data)) as Snapshot)).toBe(report);
  data.runs[1].headSha = "other";
  expect(renderReport(data)).toContain("suite › test | 2 | branch | 0/2");
  data.jobs[1].conclusion = "success";
  expect(renderReport(data)).toContain("suite › test | 1 | branch | 1/1");
});

it("does not call an earlier passing shard or an infrastructure failure a confirmed flake", () => {
  const data = snapshot();
  data.jobs[2].started_at = new Date(0).toISOString();
  data.logs[11] = "browser launch failed";
  data.jobs[1].conclusion = "failure";
  data.unavailable.push("expired log");
  const report = renderReport(data);
  expect(report).toContain("suite › test | 1 | branch | 0/1");
  expect(report).toContain("Failed shard without a parsed test ID");
  expect(report).toContain("Unavailable evidence: expired log");
});
