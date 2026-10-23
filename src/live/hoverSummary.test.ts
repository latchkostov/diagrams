import { describe, expect, it } from "vitest";
import type { NodeSimState } from "../sim/types";
import { nodeSummary, PROBLEM_PRIORITY } from "./hoverSummary";

const node = (patch: Partial<NodeSimState> = {}): NodeSimState => ({
  id: "api",
  role: "processor",
  status: "up",
  backlog: 0,
  lag: {},
  inFlight: 0,
  processed: 0,
  failed: 0,
  dropped: 0,
  deadLettered: 0,
  throughput: 0,
  ...patch,
});
describe("problem-first summaries", () => {
  it("prioritizes down, timeouts, exhausted threads and retries in that order", () => {
    const s = node({
      status: "down",
      threads: { working: 1, waiting: 3, slots: 4, queued: 1, waitingOn: [] },
      backlog: 100,
      dropped: 2,
    });
    const calls = [
      {
        inFlight: 3,
        held: 3,
        timedOut: 7,
        failed: 10,
        late: 0,
        windowRequests: 10,
        windowAttempts: 30,
        windowRetried: 20,
      },
    ];
    expect(nodeSummary(s, calls).problems.map((p) => p.key)).toEqual([
      "down",
      "timeout",
      "threads",
      "retry",
      "loss",
      "waiting",
    ]);
    expect(PROBLEM_PRIORITY.slice(0, 4)).toEqual(["down", "timeout", "threads", "retry"]);
  });
  it("reserves exactly four vitals and three summary sections as values change", () => {
    for (const role of ["source", "processor", "queue", "topic", "stream", "store", "sink", "gateway"] as const) {
      for (const backlog of [0, 1, 999, 1e8]) {
        const summary = nodeSummary(node({ role, backlog }), []);
        expect(summary.vitals).toHaveLength(4);
        expect(summary.sections).toHaveLength(3);
      }
    }
  });
  it("does not call retained unread messages lag, or deny-rule refusals losses", () => {
    const summary = nodeSummary(node({ role: "topic", noConsumer: true, backlog: 30, blocked: 4 }), [], true);
    expect(summary.vitals[1].label).toBe("Kept");
    expect(summary.problems.map((p) => p.key)).toEqual(["unread", "waiting"]);
    expect(summary.vitals[3].value).toBe("0");
  });
  it("only calls lag growing when observed backlog grew", () => {
    expect(nodeSummary(node({ role: "topic", backlog: 30 }), []).problems[0].key).toBe("waiting");
    expect(nodeSummary(node({ role: "topic", backlog: 30 }), [], true).problems[0].key).toBe("lag");
  });
});
