import type { FullConfig, FullResult, Suite, TestCase, TestError, TestResult } from "@playwright/test/reporter";
export function pendingReport(): {
  interrupted: boolean;
  expectedTests: number;
  completed: number;
  stats: { expected: number; unexpected: number; flaky: number; skipped: number };
  errors: TestError[];
  suites: unknown[];
};
export function writeCheckpoint(file: string, report: unknown): void;
export function readTestReport(directory: string): unknown;
export default class CheckpointReporter {
  onBegin(config: FullConfig, suite: Suite): void;
  onTestEnd(test: TestCase, result: TestResult): void;
  onError(error: TestError): void;
  onEnd(result: FullResult): void;
}
