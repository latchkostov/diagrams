import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

/** Synchronous, atomic checkpoints survive termination before Playwright's JSON reporter flushes. */
export function writeCheckpoint(file, report) {
  writeFileSync(`${file}.tmp`, JSON.stringify(report));
  renameSync(`${file}.tmp`, file);
}

export function pendingReport() {
  return {
    interrupted: true,
    expectedTests: 0,
    completed: 0,
    stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    errors: [],
    suites: [],
  };
}

/** Keep final counts, plus the checkpoint's terminal status (JSON has no interruption flag). */
export function readTestReport(directory) {
  const read = (name) => {
    try {
      return JSON.parse(readFileSync(join(directory, name), "utf8"));
    } catch {
      return undefined;
    }
  };
  const final = read("results.json");
  const checkpoint = read("checkpoint.json");
  if (final) {
    if (checkpoint?.interrupted && checkpoint.expectedTests > 0)
      return { ...final, interrupted: true, completed: checkpoint.completed, expectedTests: checkpoint.expectedTests };
    return final;
  }
  if (checkpoint) return checkpoint;
  throw new Error("No readable final report or checkpoint");
}

export default class CheckpointReporter {
  constructor() {
    this.file = process.env.GATE_CHECKPOINT;
    this.report = pendingReport();
    this.tests = new Map();
  }

  onBegin(config, suite) {
    this.root = config.rootDir;
    this.report.expectedTests = suite.allTests().length;
    this.save();
  }

  onTestEnd(test, result) {
    const entry = this.tests.get(test.id) ?? {
      title: test.titlePath().slice(3).join(" › ") || test.title,
      file: relative(this.root, test.location.file).replaceAll("\\", "/"),
      line: test.location.line,
      tests: [{ projectName: test.parent.project().name, status: "expected", results: [] }],
    };
    entry.tests[0].status = test.outcome();
    entry.tests[0].results.push({ status: result.status, duration: result.duration, error: result.error });
    this.tests.set(test.id, entry);
    this.save();
  }

  onError(error) {
    this.report.errors.push({ message: error.message ?? String(error) });
    this.save();
  }

  onEnd(result) {
    this.report.interrupted = ["interrupted", "timedout"].includes(result.status);
    this.save();
  }

  save() {
    const specs = [...this.tests.values()];
    this.report.completed = specs.length;
    this.report.suites = [{ specs }];
    for (const status of Object.keys(this.report.stats))
      this.report.stats[status] = specs.filter((spec) => spec.tests[0].status === status).length;
    writeCheckpoint(this.file, this.report);
  }
}
