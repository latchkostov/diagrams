export interface FailedTest {
  spec: string;
  title: string;
  message?: string;
  failurePattern?: string;
}
export interface Job {
  name: string;
  conclusion: string | null;
  steps?: { name: string; conclusion: string | null }[];
}
export function failedTests(report: Record<string, unknown>): { failed: FailedTest[]; unknown: string[] };
export function classifyRun(
  jobs: Job[],
  reports: { job: string; report: Record<string, unknown> }[],
  ledger: FailedTest[],
): string[];
export function checkRun(runId: string, dependencies?: { gh: (...args: string[]) => string }): string[];
