import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { failedTests, renderReport, type Snapshot } from "../../scripts/ci/flake-report.mjs";
import rerunSnapshot from "../../tests/fixtures/ci-flake-report/rerun-snapshot.json";
import actionsRerun from "../../tests/fixtures/ci-flake-report/actions-rerun.json";

const interruptedLog = readFileSync(
  new URL("../../tests/fixtures/ci-flake-report/interrupted.log", import.meta.url),
  "utf8",
);
const repeatedInterruptedLog = readFileSync(
  new URL("../../tests/fixtures/ci-flake-report/repeated-interrupted.log", import.meta.url),
  "utf8",
);

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

it("excludes interrupted and cancelled tests while retaining failures emitted before cancellation", () => {
  for (const status of ["interrupted", "cancelled", "canceled"]) {
    const log = interruptedLog.replaceAll("interrupted", status);
    expect(failedTests(log).map((test) => test.title)).toEqual(["actual failure"]);
    expect(
      failedTests(log.slice(log.indexOf("2026-10-25T00:00:00.0000000Z   1 failed"))).map((test) => test.title),
    ).toEqual(["actual failure"]);
    // A cancelled job may end before the reporter writes its final summary.
    expect(failedTests(log.split("2026-10-25T00:00:00.0000000Z   1 failed")[0]).map((test) => test.title)).toEqual([
      "actual failure",
    ]);
    const data = snapshot();
    data.logs[11] = log;
    const report = renderReport(data);
    expect(report).toContain("actual failure | 1 | branch | 1/1");
    expect(report).not.toContain(`› ${status} by failure limit |`);
  }
});

it.each(["interrupted", "cancelled", "canceled"])(
  "keeps %s status across repeated Actions annotations in either order",
  (status) => {
    const log = repeatedInterruptedLog.replaceAll("interrupted", status);
    const summary = "2026-10-25T00:00:00.0000000Z   1 failed";
    for (const section of [log, log.split(summary)[0], log.slice(log.indexOf(summary))]) {
      expect(failedTests(section).map((test) => test.title)).toEqual(["actual failure"]);
      const data = snapshot();
      data.logs[11] = section;
      const report = renderReport(data);
      expect(report).toContain("actual failure | 1 | branch | 1/1");
      expect(report).not.toContain(`› ${status} by failure limit |`);
    }
    // An annotation already counted as a candidate must be removed when interruption becomes known.
    const throughInterruption = log.slice(0, log.indexOf("Test was") + `Test was ${status}.`.length);
    expect(failedTests(throughInterruption).map((test) => test.title)).toEqual(["actual failure"]);
  },
);

it("retains the latest complete successful earlier attempt after a partial rerun", () => {
  const report = renderReport(rerunSnapshot);
  expect(report).toContain("Run 90, attempt 2, SHA recent");
  const latest = report.split("## Latest complete successful shard set")[1].split("## Collection coverage")[0];
  expect(latest).toContain("| E2E 1/2 | 30 | 50.0% | 75.0% |");
  expect(latest).toContain("| E2E 2/2 | 50 | 83.3% | 125.0% |");
  expect(latest).not.toContain("NaN");
  // Historical means retain all completed attempts, including the partial rerun's finished shard.
  expect(report).toContain("| E2E 1/2 | 4 | 32.5 | 70.0");
  expect(report).toContain("| E2E 2/2 | 3 | 33.3 | 50.0");
  expect(renderReport({ ...rerunSnapshot, jobs: [...rerunSnapshot.jobs].reverse() })).toBe(report);
});

it("preserves recorded Actions shard measurements when a later attempt has no E2E jobs", () => {
  const data = structuredClone(actionsRerun);
  data.runs[0].attempt++;
  const report = renderReport(data);
  expect(report).toContain("Run 40160789032, attempt 2, SHA 4e1327efbb926cfba2f41156ddd292c7228e3d7e");
  expect(report).toContain("| E2E 1/6 | 2 | 959.0 | 959.0");
  const comparison = (text: string) =>
    text.split("## Latest complete successful shard set")[1].split("## Collection coverage")[0];
  expect(comparison(report)).toBe(comparison(renderReport(actionsRerun)));
  expect(comparison(report)).toContain("| E2E 1/6 | 959 |");
  expect(comparison(report)).toContain("| E2E 4/6 | 473 |");
});

it("does not mix shard measurements across attempts to invent a complete successful set", () => {
  const data = structuredClone(rerunSnapshot);
  data.jobs.find((job) => job.runId === 90 && job.attempt === 2 && job.name === "E2E 2/2")!.conclusion = "failure";
  data.jobs.find((job) => job.runId === 90 && job.attempt === 1 && job.name === "E2E 1/2")!.conclusion = "failure";
  expect(renderReport(data)).toContain("Run 80, attempt 1, SHA older");
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
  expect(report).toContain("Run 3, attempt 1, SHA different");
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
