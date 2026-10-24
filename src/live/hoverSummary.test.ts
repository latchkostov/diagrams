import { describe, expect, it } from "vitest";
import { HealthWindow } from "./healthWindow";
import type { EdgeSimState } from "../sim/types";
import type { NodeSimState } from "../sim/types";
import type { DiagramFile } from "../model/types";
import { compileTopology } from "../sim/topology";
import { edgeReadoutKind, flowSummary, nodeSummary, PROBLEM_PRIORITY, requestSummary } from "./hoverSummary";

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
function observe(s: NodeSimState, calls: NonNullable<EdgeSimState["calls"]>[] = []) {
  const window = new HealthWindow();
  window.observe(
    {
      time: 0,
      nodes: { api: node() },
      edges: Object.fromEntries(
        calls.map((c, i) => [i, { id: String(i), active: 0, delivered: 0, calls: { ...c, timedOut: 0, failed: 0 } }]),
      ),
    },
    0,
  );
  window.observe(
    {
      time: 1000,
      nodes: { api: s },
      edges: Object.fromEntries(calls.map((c, i) => [i, { id: String(i), active: 0, delivered: 0, calls: c }])),
    },
    0,
  );
}
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
    observe(s, calls);
    expect(nodeSummary(s, calls).problems.map((p) => p.key)).toEqual(["down", "timeout", "threads", "retry", "loss"]);
    expect(PROBLEM_PRIORITY.slice(0, 5)).toEqual(["down", "timeout", "threads", "breaker", "retry"]);
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
    expect(summary.problems.map((p) => p.key)).toEqual(["unread"]);
    expect(summary.vitals[3].value).toBe("0");
  });
  it("only calls lag growing when observed backlog grew", () => {
    expect(nodeSummary(node({ role: "topic", backlog: 30 }), []).problems).toEqual([]);
    expect(nodeSummary(node({ role: "topic", backlog: 30 }), [], true).problems[0].key).toBe("lag");
  });
});

describe("dead letters are moved, not lost", () => {
  it("counts only drops as loss and shows dead-letter transfers apart", () => {
    const moved = nodeSummary(node({ deadLettered: 10 }), []);
    expect(moved.problems.map((p) => p.key)).not.toContain("loss");
    expect(moved.vitals.find((v) => v.key === "loss")?.value).toBeUndefined();
    expect(moved.facts.find((f) => f.key === "deadLettered")).toMatchObject({ value: "10" });
    expect(moved.facts.find((f) => f.key === "deadLettered")?.bad).toBeFalsy();
    const state = node({ role: "queue", deadLettered: 10, dropped: 2 });
    observe(state);
    const broker = nodeSummary(state, []);
    expect(broker.problems.find((p) => p.key === "loss")?.text).toBe("2 messages lost.");
    expect(broker.vitals.find((v) => v.key === "loss")).toBeUndefined();
  });
});

describe("connection cards", () => {
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "Edges",
    planning: { revision: "p3-w2" },
    nodes: [
      { id: "svc", stencil: "generic.service", label: "Service", x: 0, y: 0 },
      { id: "api", stencil: "generic.service", label: "API", x: 300, y: 0 },
      { id: "topic", stencil: "generic.topic", label: "Topic", x: 300, y: 200 },
      { id: "cfg", stencil: "azure.app-configuration", label: "Config", x: 0, y: 200 },
    ],
    edges: [
      { id: "call", from: "svc", to: "api", kind: "sync" },
      { id: "publish", from: "svc", to: "topic" },
      { id: "config", from: "svc", to: "cfg", relation: "config" },
      { id: "denied", from: "svc", to: "api", kind: "sync", props: { share: 0 } },
    ],
  } as DiagramFile;
  const kind = (d: DiagramFile, id: string) =>
    edgeReadoutKind(
      d,
      d.edges.find((e) => e.id === id)!,
      compileTopology(d),
    );
  it("gives caller semantics only to active Request edges in a model where callers wait", () => {
    expect(kind(diagram, "call")).toBe("request");
    expect(kind(diagram, "publish")).toBe("flow");
    expect(kind(diagram, "config")).toBe("dependency");
    expect(kind(diagram, "denied")).toBe("flow");
    expect(kind({ ...diagram, planning: { revision: "p3" } } as DiagramFile, "call")).toBe("flow");
  });
  it("message and dependency summaries carry no thread, retry, timeout or request readouts", () => {
    for (const summary of [
      flowSummary("flow", { id: "publish", delivered: 7, active: 2 }),
      flowSummary("dependency", undefined),
    ]) {
      const keys = [...summary.vitals, ...summary.facts, ...summary.sections].map((f) => f.key);
      for (const key of ["held", "timeouts", "retries", "breaker", "requests", "attempts", "goodput"])
        expect(keys).not.toContain(key);
      expect(summary.problems).toEqual([]);
    }
    expect(flowSummary("flow", { id: "publish", delivered: 7, active: 2 }).vitals.map((v) => v.value)).toEqual([
      "7",
      "2",
    ]);
  });
  const view = (patch: Partial<import("../sim/breaker").BreakerView>) => ({
    state: "closed" as const,
    remainingMs: 0,
    probesSent: 0,
    probesSettled: 0,
    probesInFlight: 0,
    probes: 5,
    failurePercent: 0,
    calls: 0,
    ...patch,
  });
  it("reports the breaker's published runtime state in its verdict and section", () => {
    const closed = requestSummary(undefined, view({}), true, 0);
    expect(closed.problems).toEqual([]);
    expect(closed.sections.find((s) => s.key === "breaker")?.summary).toBe("Closed · calls allowed");
    const open = requestSummary(undefined, view({ state: "open", remainingMs: 2500 }), true, 0);
    expect(open.problems[0]).toMatchObject({ key: "breaker", severe: true });
    expect(open.problems[0].text).toContain("3 more seconds");
    expect(open.sections.find((s) => s.key === "breaker")?.summary).toBe("Open · failing fast");
    const testing = requestSummary(undefined, view({ state: "half-open", probesSettled: 2 }), true, 0);
    expect(testing.problems[0]).toMatchObject({
      key: "breaker",
      text: "Breaker testing the callee: 2 of 5 test calls settled.",
    });
    expect(testing.sections.find((s) => s.key === "breaker")?.summary).toBe("Testing · checking recovery");
    expect(requestSummary(undefined, undefined, true, 0).sections.find((s) => s.key === "breaker")?.summary).toBe("—");
    // Current breaker state leads cumulative timeout counts.
    const calls = { inFlight: 5, held: 0, timedOut: 20, failed: 20, late: 0 };
    observe(node(), [calls]);
    expect(requestSummary(calls, view({ state: "half-open" }), true, 0).problems.map((p) => p.key)).toEqual([
      "breaker",
      "timeout",
    ]);
  });
});

it("keeps the hero verdict out of attention facts and cumulative timeouts out of duplicate summaries", () => {
  const calls = { inFlight: 1, held: 1, timedOut: 42, failed: 42, succeeded: 100, late: 0 };
  observe(node(), [calls]);
  const n = nodeSummary(node(), [calls]);
  expect(n.problems[0].key).toBe("timeout");
  expect(n.facts.some((f) => f.label === n.problems[0].text)).toBe(false);
  const e = requestSummary(calls, undefined, true, 0);
  expect(e.facts.some((f) => f.label === e.problems[0].text)).toBe(false);
  expect(e.facts.some((f) => f.key === "timeouts")).toBe(false);
});

it("historical shedding is a cumulative fact, never a current rejection verdict", () => {
  const summary = nodeSummary(node({ rejected: 12, shed: 12, queueDepth: 2, queueLimit: 3 }), []);
  expect(summary.problems).toEqual([]);
  expect(summary.facts.find((f) => f.key === "shed")?.label).toContain("since restart");
  expect(summary.facts.find((f) => f.key === "queueLimit")?.value).toBe("2 of 3 queued");
});
