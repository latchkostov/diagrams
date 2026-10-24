import { expect, it } from "vitest";
import { classifyRun, failedTests } from "../../scripts/ci/known-flakes.mjs";
import { withRunErrors } from "../../scripts/ci/vitest-json.mjs";
import ledger from "../../tests/flakes.json";
import { existsSync } from "node:fs";

const test = { spec: "src/example.test.ts", title: "regression" };
const jobs = [
  { name: "Unit coverage 1/3", conclusion: "failure", steps: [{ name: "Unit coverage", conclusion: "failure" }] },
];
const report = {
  numTotalTests: 1,
  numFailedTests: 1,
  testResults: [
    {
      name: "C:\\repo\\src\\example.test.ts",
      status: "failed",
      assertionResults: [{ title: test.title, status: "failed" }],
    },
  ],
};
const reports = [{ job: jobs[0].name, report }];

it("recognizes exact failed test identities across Vitest and Playwright reports", () => {
  expect(failedTests(report)).toEqual({ failed: [{ ...test, message: "" }], unknown: [] });
  expect(
    failedTests({
      ...report,
      testResults: [{ ...report.testResults[0], name: "L:/src/personal/diagrams-detci/src/example.test.ts" }],
    }).failed[0].spec,
  ).toBe(test.spec);
  expect(classifyRun(jobs, reports, [test])).toEqual([]);
  const browser = {
    stats: { unexpected: 1 },
    suites: [
      {
        suites: [
          {
            specs: [
              { file: "tests/e2e/example.spec.ts", title: "browser", tests: [{ results: [{ status: "timedOut" }] }] },
            ],
          },
        ],
      },
    ],
  };
  expect(failedTests(browser).failed).toEqual([{ spec: "tests/e2e/example.spec.ts", title: "browser", message: "" }]);
  const browserJob = {
    name: "E2E 1/6",
    conclusion: "failure",
    steps: [{ name: "Playwright shard", conclusion: "failure" }],
  };
  expect(
    classifyRun(
      [browserJob],
      [{ job: browserJob.name, report: browser }],
      [{ spec: "tests/e2e/example.spec.ts", title: "browser" }],
    ),
  ).toEqual([]);
  expect(
    classifyRun(
      [{ ...browserJob, steps: [{ name: "Playwright shard / System deps and builds", conclusion: "failure" }] }],
      [{ job: browserJob.name, report: browser }],
      [{ spec: "tests/e2e/example.spec.ts", title: "browser" }],
    ),
  ).not.toEqual([]);
  expect(
    failedTests({
      config: { rootDir: "/work/tests/e2e" },
      stats: { unexpected: 1 },
      suites: [
        { specs: [{ file: "example.spec.ts", title: "browser", tests: [{ results: [{ status: "failed" }] }] }] },
      ],
    }).failed[0].spec,
  ).toBe("tests/e2e/example.spec.ts");
});

it("fails closed for unknown tests, setup errors, missing reports, cancellations and infrastructure failures", () => {
  expect(classifyRun(jobs, reports, [])).toEqual(["src/example.test.ts > regression"]);
  expect(classifyRun(jobs, reports, [{ ...test, title: "other" }])).not.toEqual([]);
  expect(classifyRun(jobs, [], [test])).not.toEqual([]);
  expect(classifyRun([{ ...jobs[0], conclusion: "cancelled" }], reports, [test])).not.toEqual([]);
  expect(classifyRun([{ ...jobs[0], steps: [{ name: "Build", conclusion: "failure" }] }], reports, [test])).not.toEqual(
    [],
  );
  expect(failedTests({ ...report, unhandledErrors: ["crashed"] }).unknown).not.toEqual([]);
  expect(failedTests({ numTotalTests: 0, testResults: [{ name: test.spec, status: "failed" }] }).unknown).not.toEqual(
    [],
  );
  expect(failedTests({ suites: [], stats: { unexpected: 1 }, errors: ["server gone"] }).unknown).not.toEqual([]);
  expect(failedTests({}).unknown).not.toEqual([]);
});

it("only ignores the aggregate CI failure when another failed job explains it", () => {
  expect(
    classifyRun(
      [
        ...jobs,
        { name: "CI", conclusion: "failure", steps: [{ name: "Check results", conclusion: "failure" }] },
        {
          name: "Types, lint, unit, build",
          conclusion: "failure",
          steps: [{ name: "Require every lane", conclusion: "failure" }],
        },
      ],
      reports,
      [test],
    ),
  ).toEqual([]);
  expect(classifyRun([{ name: "CI", conclusion: "failure" }], [], [test])).not.toEqual([]);
});

it("keeps runner and hook errors visible alongside a known failing assertion", () => {
  const diagnostic = withRunErrors(
    report,
    [{ name: "Unhandled Rejection", message: "unknown runner defect" }],
    "failed",
  );
  expect(classifyRun(jobs, [{ job: jobs[0].name, report: diagnostic }], [test])).not.toEqual([]);
  expect(
    failedTests({ ...report, testResults: [{ ...report.testResults[0], message: "afterAll failed" }] }).unknown,
  ).not.toEqual([]);
  expect(failedTests(withRunErrors(report, [], "interrupted")).unknown).not.toEqual([]);
  expect(failedTests({ ...report, snapshot: { failure: true } }).unknown).not.toEqual([]);
});

it("does not mistake a real assertion regression for a timeout in the same ledger test", () => {
  expect(classifyRun(jobs, reports, [{ ...test, failurePattern: "Test timed out" }])).not.toEqual([]);
  const timeout = {
    ...report,
    testResults: [
      {
        ...report.testResults[0],
        assertionResults: [{ title: test.title, status: "failed", failureMessages: ["Test timed out in 30000ms."] }],
      },
    ],
  };
  expect(
    classifyRun(jobs, [{ job: jobs[0].name, report: timeout }], [{ ...test, failurePattern: "Test timed out" }]),
  ).toEqual([]);
});

it("keeps owned, dated entries with real tracking fragments and excludes the three #263 fixes", () => {
  expect(new Set(ledger.map((entry) => entry.id)).size).toBe(ledger.length);
  for (const entry of ledger) {
    expect(entry.owner).not.toBe("");
    expect(entry.firstSeen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.lastSeen >= entry.firstSeen).toBe(true);
    expect(entry.count).toBeGreaterThan(0);
    expect(existsSync(entry.tracking)).toBe(true);
    expect(entry.spec).not.toBe("src/interop/infra/kubernetes.test.ts");
    expect(entry.spec).not.toBe("tests/e2e/lazy-live-fixes.spec.ts");
    expect(entry.title).not.toBe("an open Inputs panel and capacity Apply fix wait until slow motion ends");
  }
});
