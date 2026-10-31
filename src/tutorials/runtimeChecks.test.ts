/* eslint-disable local/no-literal-ui-text -- Diagram labels in these fixtures are test inputs, not UI copy. */
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import { initialEditorMode } from "../canvas/interaction/mode";
import type { DiagramFile, Simulation } from "../model/types";
import { holds, nearMiss, resolveSubjects, type SandboxView } from "./checks";
import { mobileApi } from "./catalog/mobileApi";
import type { Check, MetricComparison, MetricExpr, NodeMetric } from "./types";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "test",
  groups: [{ id: "boundary", label: "Boundary", x: 0, y: 0, width: 500, height: 300 }],
  nodes: [
    {
      id: "a",
      stencil: "client.mobile",
      label: "App",
      x: 50,
      y: 50,
      group: "boundary",
      props: { rate: 12, enabled: false },
    },
    { id: "b", stencil: "generic.service", label: "API", x: 250, y: 50 },
  ],
  edges: [{ id: "ab", from: "a", to: "b", kind: "sync", props: { timeoutMs: 200 } }],
  annotations: [{ id: "text", kind: "text", text: "test", x: 0, y: 0, width: 100, height: 40 }],
};
const subjects = { app: "a", api: "b", box: "boundary" };
function view(): SandboxView {
  const controller = new LiveController(diagram);
  return { diagram, live: true, processed: () => 0, session: controller.getState(), mode: initialEditorMode };
}
const met = (check: Check, v = view()) => holds(check, v, subjects);

describe("runtime check kinds", () => {
  it("checks explicit edge sides rather than similarly named simulation props", () => {
    const check: Check = { kind: "prop", edge: ["app", "api"], prop: "targetSide", op: "=", value: "top" };
    const v = view();
    v.diagram = { ...diagram, edges: [{ ...diagram.edges[0], props: { targetSide: "top" } }] };
    expect(met(check, v)).toBe(false);
    v.diagram.edges[0].targetSide = "top";
    expect(met(check, v)).toBe(true);
  });
  it("checks node subtitles and nonempty descriptions, without reading simulation props", () => {
    const v = view();
    const subtitle: Check = { kind: "field", subject: "api", field: "sublabel", is: () => "Node.js" };
    const description: Check = { kind: "field", subject: "api", field: "description" };
    expect(met(subtitle, v)).toBe(false);
    expect(met(description, v)).toBe(false);
    v.diagram = {
      ...diagram,
      nodes: [diagram.nodes[0], { ...diagram.nodes[1], sublabel: " node.JS ", description: "   " }],
    };
    expect(met(subtitle, v)).toBe(true);
    expect(met(description, v)).toBe(false);
    v.diagram.nodes[1].description = "Accepts payments";
    expect(met(description, v)).toBe(true);
  });
  it("requires both a new connection and absence of the old one after reconnecting", () => {
    const check: Check = { kind: "relation", from: "app", to: "api", absent: true };
    expect(met(check)).toBe(false);
    expect(met(check, { ...view(), diagram: { ...diagram, edges: [] } })).toBe(true);
    expect(holds(check, view(), {})).toBe(false);
  });
  it("checks whose naming mode is open, rather than accepting any name field", () => {
    const check: Check = { kind: "mode", value: "naming", subject: "api" };
    for (const target of [null, "a", "b"])
      expect(met(check, { ...view(), mode: { ...initialEditorMode, value: "naming", target } })).toBe(target === "b");
    expect(holds(check, { ...view(), mode: { ...initialEditorMode, value: "naming", target: null } }, {})).toBe(false);
  });
  it("checks committed selections by subject, count and exact membership", () => {
    const v = view();
    expect(met({ kind: "selection", subjects: ["app"] }, v)).toBe(false);
    expect(met({ kind: "selection", subjects: [], exact: true }, v)).toBe(true);
    v.mode = { ...initialEditorMode, selection: ["a", "b"] };
    expect(met({ kind: "selection", subjects: ["app"] }, v)).toBe(true);
    expect(met({ kind: "selection", subjects: ["app"], exact: true }, v)).toBe(false);
    expect(met({ kind: "selection", subjects: ["app", "api"], exact: true }, v)).toBe(true);
    expect(met({ kind: "selection", subjects: ["missing"] }, v)).toBe(false);
    expect(met({ kind: "selection", atLeast: 3 }, v)).toBe(false);
    expect(met({ kind: "selection", atLeast: 2 }, v)).toBe(true);
  });
  it("compares actual coordinates of at least two existing nodes, including the selection", () => {
    const v = view();
    expect(met({ kind: "aligned", subjects: ["app", "api"], axis: "y" }, v)).toBe(true);
    expect(met({ kind: "aligned", subjects: ["app", "api"], axis: "x" }, v)).toBe(false);
    expect(met({ kind: "aligned", subjects: ["app", "missing"], axis: "y" }, v)).toBe(false);
    expect(met({ kind: "aligned", subjects: ["app"], axis: "y" }, v)).toBe(false);
    expect(met({ kind: "aligned", subjects: [], axis: "y" }, v)).toBe(false);
    v.mode = { ...initialEditorMode, selection: ["a", "b"] };
    expect(met({ kind: "aligned", axis: "y" }, v)).toBe(true);
    expect(met({ kind: "aligned", axis: "y", atLeast: 4 }, v)).toBe(false);
    v.diagram = { ...diagram, nodes: [diagram.nodes[0], { ...diagram.nodes[1], y: 51 }] };
    expect(met({ kind: "aligned", axis: "y" }, v)).toBe(false);
  });
  it("requires explicit published app and dependency state, and leaves acknowledgements to the learner", () => {
    const v = view();
    for (const check of [
      { kind: "presenting", on: false },
      { kind: "presenting", on: true },
      { kind: "sharing" },
      { kind: "dependencies", visible: false },
    ] as const)
      expect(met(check, v)).toBe(false);
    expect(met({ kind: "presenting", on: true }, { ...v, presenting: true })).toBe(true);
    expect(met({ kind: "presenting", on: false }, { ...v, presenting: false })).toBe(true);
    expect(met({ kind: "sharing" }, { ...v, sharing: true })).toBe(true);
    expect(met({ kind: "sharing" }, { ...v, sharing: false })).toBe(false);
    expect(met({ kind: "dependencies", visible: false }, { ...v, dependencies: false })).toBe(true);
    expect(met({ kind: "dependencies", visible: true }, { ...v, dependencies: true })).toBe(true);
    expect(met({ kind: "acknowledge" }, v)).toBe(false);
  });
  it("compares node and edge props, without coercing or accepting missing values", () => {
    for (const op of ["=", ">=", "<="] as const) {
      expect(met({ kind: "prop", subject: "app", prop: "rate", op, value: 12 })).toBe(true);
      expect(met({ kind: "prop", edge: ["app", "api"], prop: "timeoutMs", op, value: 200 })).toBe(true);
    }
    expect(met({ kind: "prop", subject: "app", prop: "enabled", op: "=", value: false })).toBe(true);
    expect(met({ kind: "prop", subject: "api", prop: "rate", op: "<=", value: 12 })).toBe(false);
    expect(met({ kind: "prop", subject: "app", prop: "rate", op: "=", value: "12" })).toBe(false);
    expect(met({ kind: "prop", edge: ["api", "app"], prop: "timeoutMs", op: "=", value: 200 })).toBe(false);
    const v = view();
    v.diagram = { ...diagram, nodes: [{ ...diagram.nodes[0], props: { settings: { a: 1, b: [2, 3] } } }] };
    expect(met({ kind: "prop", subject: "app", prop: "settings", op: "=", value: { b: [2, 3], a: 1 } }, v)).toBe(true);
    expect(met({ kind: "prop", subject: "app", prop: "settings", op: "=", value: { b: [3, 2], a: 1 } }, v)).toBe(false);
  });
  it.each(["=", ">=", "<="] as const)("compares props and metrics below, at and above thresholds (%s)", (op) => {
    for (const actual of [11, 12, 13]) {
      const v = view();
      v.diagram = {
        ...diagram,
        nodes: [{ ...diagram.nodes[0], props: { rate: actual } }, diagram.nodes[1]],
        edges: [{ ...diagram.edges[0], props: { timeoutMs: actual } }],
      };
      v.session!.snapshot.nodes.b.processed = actual;
      v.session!.snapshot.nodes.b.latency = {
        samples: 1,
        p50: actual,
        p95: actual,
        p99: actual,
        waitMs: 0,
        workMs: actual,
        travelMs: 0,
        byType: {},
      };
      v.session!.snapshot.nodes.b.threads = { slots: 24, working: 0, waiting: actual, waitingOn: [], queued: 0 };
      const expected = op === "=" ? actual === 12 : op === ">=" ? actual >= 12 : actual <= 12;
      expect(met({ kind: "prop", subject: "app", prop: "rate", op, value: 12 }, v)).toBe(expected);
      expect(met({ kind: "prop", edge: ["app", "api"], prop: "timeoutMs", op, value: 12 }, v)).toBe(expected);
      for (const field of ["processed", "latency.p95", "threads.waiting"] as const)
        expect(met({ kind: "metric", subject: "api", field, op, value: 12 }, v)).toBe(expected);
    }
  });
  it("checks relationships and Request versus Message in the requested direction", () => {
    expect(met({ kind: "relation", from: "app", to: "api", relation: "flow", edgeKind: "sync" })).toBe(true);
    expect(met({ kind: "relation", from: "app", to: "api", edgeKind: "async" })).toBe(false);
    expect(met({ kind: "relation", from: "api", to: "app" })).toBe(false);
    expect(met({ kind: "relation", from: "app", to: "api", relation: "secret" })).toBe(false);
  });
  it("resolves distinct boundary subjects and checks membership against existing boundaries", () => {
    const tutorial = {
      ...mobileApi,
      subjects: { app: { stencils: ["client.mobile"] }, box: { boundary: true as const } },
    };
    expect(resolveSubjects(tutorial, diagram)).toEqual({ app: "a", box: "boundary" });
    expect(met({ kind: "member", subject: "app", boundary: "box" })).toBe(true);
    expect(met({ kind: "member", subject: "api", boundary: "box" })).toBe(false);
    expect(
      met({ kind: "member", subject: "app", boundary: "box" }, { ...view(), diagram: { ...diagram, groups: [] } }),
    ).toBe(false);
  });
  it("uses the same name check and near-miss words for a boundary, including composite checks", () => {
    const check: Check = { kind: "label", subject: "box", is: () => "Payments" };
    expect(met(check)).toBe(false);
    expect(nearMiss({ kind: "all", checks: [check] }, view(), subjects)).toEqual({
      expected: "Payments",
      typed: "Boundary",
    });
    const v = view();
    v.diagram = { ...diagram, groups: [{ ...diagram.groups![0], label: " payments " }] };
    expect(met(check, v)).toBe(true);
    v.diagram.groups![0].label = "Neutral";
    expect(nearMiss(check, v, subjects)).toBeNull();
  });
  it.each(["text", "note", "zone", "shape"] as const)(
    "counts %s annotations, including missing lists",
    (annotation) => {
      const v = view();
      v.diagram = { ...diagram, annotations: [{ ...diagram.annotations![0], kind: annotation }] };
      expect(met({ kind: "annotation", annotation }, v)).toBe(true);
      expect(met({ kind: "annotation", annotation, count: 2 }, v)).toBe(false);
      expect(met({ kind: "annotation", annotation }, { ...v, diagram: { ...diagram, annotations: undefined } })).toBe(
        false,
      );
    },
  );
  it("reads real node counters, latency, waiting threads and an edge's breaker", () => {
    const v = view();
    v.session!.snapshot.nodes.b = {
      ...v.session!.snapshot.nodes.b,
      processed: 50,
      latency: { samples: 1, p50: 10, p95: 20, p99: 30, waitMs: 0, workMs: 10, travelMs: 0, byType: {} },
      threads: { slots: 10, working: 2, waiting: 4, waitingOn: [], queued: 0 },
    };
    v.session!.snapshot.edges.ab = {
      id: "ab",
      active: 0,
      delivered: 0,
      breaker: {
        state: "open",
        remainingMs: 1,
        probesSent: 0,
        probesSettled: 0,
        probesInFlight: 0,
        probes: 0,
        failurePercent: 50,
        calls: 20,
      },
    };
    for (const [field, value] of [
      ["processed", 50],
      ["latency.p95", 20],
      ["threads.waiting", 4],
    ] as const)
      expect(met({ kind: "metric", subject: "api", field, op: ">=", value }, v)).toBe(true);
    expect(
      met({ kind: "metric", subject: "app", field: "breaker", op: "=", value: "open", edge: ["app", "api"] }, v),
    ).toBe(true);
    expect(met({ kind: "metric", subject: "app", field: "breaker", op: "=", value: "closed" }, v)).toBe(false);
    expect(met({ kind: "metric", subject: "missing", field: "processed", op: "<=", value: 5 }, v)).toBe(false);
    expect(
      met({ kind: "metric", subject: "api", field: "processed", op: ">=", value: 50 }, { ...v, live: false }),
    ).toBe(false);
  });
  it("requires the actual running simulation, elapsed time and a passing expectation", () => {
    const v = view();
    const sim = { id: "demo", title: "Demo", traffic: [] };
    v.session!.running = sim;
    v.session!.run = {
      time: 500,
      totalMs: 1000,
      done: false,
      waiting: true,
      expectations: [{ id: "ok", label: "Ready", status: "pass", value: 1 }],
      markers: [],
    };
    expect(met({ kind: "simulation", id: "demo", atLeastMs: 500 }, v)).toBe(true);
    expect(met({ kind: "simulation", id: "demo", atLeastMs: 501 }, v)).toBe(false);
    expect(met({ kind: "simulation", id: "other" }, v)).toBe(false);
    expect(met({ kind: "expectation", simulation: "demo", label: () => "Ready" }, v)).toBe(true);
    expect(met({ kind: "expectation", simulation: "demo", label: "ok" }, v)).toBe(true);
    expect(met({ kind: "expectation", simulation: "other", label: () => "Ready" }, v)).toBe(false);
    v.session!.run.expectations[0].status = "pending";
    expect(met({ kind: "expectation", simulation: "demo", label: () => "Ready" }, v)).toBe(false);
    v.session!.needsRestart = true;
    expect(met({ kind: "simulation", id: "demo" }, v)).toBe(false);
  });
  it("recognises only active faults and down status, including boundary and link targets", () => {
    const v = view();
    v.session!.snapshot.faults = [
      { kind: "slow", node: "b", factor: 5 },
      { kind: "fail", node: "b", rate: 0.5 },
      { kind: "link", edge: "ab", cut: true },
      { kind: "boundary", boundary: "boundary", down: true },
    ];
    for (const fault of ["slow", "fail"] as const) expect(met({ kind: "fault", subject: "api", fault }, v)).toBe(true);
    expect(met({ kind: "fault", subject: "box", fault: "down" }, v)).toBe(true);
    expect(met({ kind: "fault", edge: ["app", "api"], fault: "cut" }, v)).toBe(true);
    expect(met({ kind: "fault", subject: "api", fault: "down" }, v)).toBe(false);
    v.session!.snapshot.nodes.b.status = "down";
    expect(met({ kind: "fault", subject: "api", fault: "down" }, v)).toBe(true);
    v.session!.snapshot.faults = [
      { kind: "slow", node: "a", factor: 1 },
      { kind: "link", edge: "ab", cut: false },
    ];
    expect(met({ kind: "fault", subject: "app" }, v)).toBe(false);
    expect(met({ kind: "fault", edge: ["app", "api"] }, v)).toBe(false);
  });
  it("reads trace, narration and slow-motion machine state instead of UI flags", () => {
    const v = view();
    expect(met({ kind: "trace" }, v)).toBe(false);
    v.session!.trace = { rootId: 1 };
    expect(met({ kind: "trace" }, v)).toBe(true);
    expect(met({ kind: "note", waiting: false }, v)).toBe(false);
    v.session!.run = { time: 0, totalMs: 100, done: false, waiting: true, expectations: [], markers: [] };
    expect(met({ kind: "note", waiting: true }, v)).toBe(true);
    expect(met({ kind: "note", waiting: false }, v)).toBe(false);
    for (const status of ["off", "capturing", "armed", "on"] as const)
      expect(met({ kind: "slowmo" }, { ...v, slowmo: { status } })).toBe(status === "on" || status === "capturing");
    expect(met({ kind: "mode", value: "menu" }, { ...v, mode: { ...initialEditorMode, value: "menu" } })).toBe(true);
    expect(met({ kind: "mode", value: "menu" }, v)).toBe(false);
  });
});

describe("Live metric expressions", () => {
  const queue: DiagramFile = {
    format: "diagrams/v1",
    title: "Workers",
    nodes: [
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0, props: { ratePerSec: 8 } },
      { id: "q", stencil: "aws.sqs", label: "Queue", x: 1, y: 0 },
      { id: "w1", stencil: "generic.service", label: "W1", x: 2, y: 0 },
      { id: "w2", stencil: "generic.service", label: "W2", x: 2, y: 1 },
      { id: "db", stencil: "postgres", label: "DB", x: 3, y: 0 },
    ],
    edges: [
      { id: "aq", from: "app", to: "q", kind: "async" },
      { id: "q1", from: "q", to: "w1", kind: "async" },
      { id: "q2", from: "q", to: "w2", kind: "async" },
      { id: "dep", from: "q", to: "db", kind: "sync", relation: "config" },
    ],
  };
  const names = { app: "app", queue: "q", first: "w1", second: "w2", db: "db" };
  /** A real session, with these counters as Live would show them. */
  function live(processed: Record<string, number>, delivered: Record<string, number>, generation = 1): SandboxView {
    const state = new LiveController(queue).getState();
    const nodes = Object.fromEntries(
      Object.entries(state.snapshot.nodes).map(([id, n]) => [id, { ...n, processed: processed[id] ?? n.processed }]),
    );
    const edges = Object.fromEntries(
      Object.entries(state.snapshot.edges)
        .filter(([id]) => id !== "dep")
        .map(([id, e]) => [id, { ...e, delivered: delivered[id] ?? e.delivered }]),
    );
    return {
      diagram: queue,
      live: true,
      trafficReady: true,
      sessionId: 1,
      processed: () => 0,
      session: { ...state, generation, snapshot: { ...state.snapshot, nodes, edges } },
    };
  }
  const is = (check: Check, v: SandboxView, subjects: Record<string, string | undefined> = names) =>
    holds(check, v, subjects);
  const workersDone: Check = {
    kind: "compare",
    left: { sum: "processed", nodes: ["first", "second"] },
    op: "=",
    right: { sum: "delivered", from: "queue" },
  };

  it("sums named subjects, every node a spec fits, edges between subjects and every flow out of one", () => {
    const v = live({ w1: 5, w2: 7, db: 2 }, { q1: 6, q2: 6 });
    expect(is(workersDone, v)).toBe(true);
    expect(is(workersDone, live({ w1: 5, w2: 7 }, { q1: 6, q2: 7 }))).toBe(false);
    const every: Check = {
      kind: "compare",
      left: { sum: "processed", every: { stencils: ["generic.service"] } },
      op: "=",
      right: 12,
    };
    expect(is(every, v)).toBe(true);
    expect(is({ ...every, left: { sum: "processed", every: { role: "processor" } }, op: ">=" }, v)).toBe(true);
    const pairs: Check = {
      kind: "compare",
      left: {
        sum: "delivered",
        edges: [
          ["queue", "first"],
          ["queue", "second"],
        ],
      },
      op: "=",
      right: { sum: "delivered", from: "queue" },
    };
    // `from` sums flows only: the dependency on the database carries no messages.
    expect(is(pairs, v)).toBe(true);
  });

  it("compares two readings strictly or not, and a reading with a constant", () => {
    const v = live({ w1: 3, w2: 9, db: 3 }, {});
    const db = { node: "db", metric: "processed" } as const;
    const check = (op: MetricComparison, right: MetricExpr | number): Check => ({
      kind: "compare",
      left: db,
      op,
      right,
    });
    expect(is(check("<", { node: "second", metric: "processed" }), v)).toBe(true);
    expect(is(check("<", { node: "first", metric: "processed" }), v)).toBe(false);
    expect(is(check("<=", { node: "first", metric: "processed" }), v)).toBe(true);
    expect(is(check(">", 2), v)).toBe(true);
    expect(is(check(">", 3), v)).toBe(false);
    expect(is(check("=", 3), v)).toBe(true);
    expect(is(check(">=", 4), v)).toBe(false);
  });

  it("is never met on a missing reading: Live off, a run not showing this diagram, an unbound subject, an empty set", () => {
    const v = live({ w1: 5, w2: 7 }, { q1: 6, q2: 6 });
    expect(is(workersDone, { ...v, live: false })).toBe(false);
    expect(is(workersDone, { ...v, session: undefined })).toBe(false);
    expect(is(workersDone, { ...v, trafficReady: false })).toBe(false);
    expect(is(workersDone, v, { ...names, second: undefined })).toBe(false);
    expect(is(workersDone, v, { ...names, queue: undefined })).toBe(false);
    const nobody: Check = {
      kind: "compare",
      left: { sum: "processed", every: { stencils: ["kafka.topic"] } },
      op: "<=",
      right: 0,
    };
    expect(is(nobody, v)).toBe(false);
    // An optional reading a node doesn't have isn't zero either.
    expect(is({ kind: "compare", left: { node: "app", metric: "queueLimit" }, op: "<=", right: 0 }, v)).toBe(false);
  });

  it("counts sinceStep from the step's baseline, from zero in a rebuilt run, and not at all without one", () => {
    const since: Check = {
      kind: "compare",
      left: { sinceStep: { node: "first", metric: "processed" } },
      op: ">=",
      right: 10,
    };
    const key = JSON.stringify({ node: "first", metric: "processed" });
    const v = live({ w1: 109 }, {}, 4);
    expect(is(since, v), "no baseline: another step's, or not read yet").toBe(false);
    expect(is(since, { ...v, baseline: { [key]: [100, 4, 1] } })).toBe(false);
    expect(is(since, { ...live({ w1: 110 }, {}, 4), baseline: { [key]: [100, 4, 1] } })).toBe(true);
    expect(is(since, { ...live({ w1: 12 }, {}, 5), baseline: { [key]: [100, 4, 1] } }), "a rebuilt run").toBe(true);
    expect(is(since, { ...live({ w1: 9 }, {}, 5), baseline: { [key]: [0, 4, 1] } })).toBe(false);
    // A remounted session numbers its runs from 1 again: the same generation in another session counts from zero.
    const remounted = { ...live({ w1: 12 }, {}, 4), sessionId: 2 };
    expect(is(since, { ...remounted, baseline: { [key]: [100, 4, 1] } }), "a remounted session").toBe(true);
  });
});

describe("runner forms for builds 06 to 12", () => {
  const live = (patch: Partial<SandboxView> = {}): SandboxView => ({
    ...view(),
    trafficReady: true,
    sessionId: 1,
    ...patch,
  });
  const run = { time: 0, totalMs: 1, done: false, waiting: false, markers: [], expectations: [] };

  it("reads nested readings: latency percentiles and their parts, threads, a fleet's starting replicas", () => {
    const v = live();
    const node = v.session!.snapshot.nodes.b;
    v.session!.snapshot.nodes.b = {
      ...node,
      latency: { samples: 9, p50: 40, p95: 90, p99: 120, waitMs: 30, workMs: 10, travelMs: 0, byType: {} },
      threads: { slots: 8, working: 3, waiting: 5, waitingOn: [], queued: 2 },
      fleet: { desired: 3, starting: 1, ready: 2, draining: 0, history: [] },
    } as typeof node;
    const at = (metric: NodeMetric, value: number) =>
      met({ kind: "compare", left: { node: "api", metric }, op: "=", right: value }, v);
    for (const [metric, value] of [
      ["latency.p50", 40],
      ["latency.p99", 120],
      ["latency.waitMs", 30],
      ["latency.workMs", 10],
      ["threads.working", 3],
      ["threads.queued", 2],
      ["fleet.starting", 1],
      ["fleet.desired", 3],
    ] as const)
      expect(at(metric, value), metric).toBe(true);
    expect(at("fleet.ready", 3)).toBe(false);
    // Waiting outweighs working: where-time-goes compares the two.
    const waiting: Check = {
      kind: "compare",
      left: { node: "api", metric: "latency.waitMs" },
      op: ">",
      right: { node: "api", metric: "latency.workMs" },
    };
    expect(met(waiting, v)).toBe(true);
    expect(met({ kind: "metric", subject: "api", field: "threads.working", op: ">=", value: 3 }, v)).toBe(true);
  });

  it("compares numbers the diagram says, Live or not, and sums only the nodes inside a boundary", () => {
    const d: DiagramFile = {
      ...diagram,
      nodes: [
        { ...diagram.nodes[0], props: { partitions: 4 } },
        { ...diagram.nodes[1], props: { replicas: 6 } },
      ],
    };
    const off = { ...view(), diagram: d, live: false, session: undefined };
    const ceiling: Check = {
      kind: "compare",
      left: { prop: "partitions", subject: "app" },
      op: ">=",
      right: { prop: "replicas", subject: "api" },
    };
    expect(met(ceiling, off)).toBe(false);
    expect(met({ ...ceiling, op: "<" }, off)).toBe(true);
    expect(met({ kind: "compare", left: { prop: ["missing"], subject: "app" }, op: "<=", right: 9 }, off)).toBe(false);
    const v = live({ diagram: d });
    const inBox = (role: "processor" | "source", within = "box"): Check => ({
      kind: "compare",
      left: { sum: "processed", every: { role, within } },
      op: ">=",
      right: 0,
    });
    // The boundary holds the client only: no processor inside it, and an empty sum isn't zero.
    expect(met(inBox("processor"), v)).toBe(false);
    expect(met(inBox("source"), v)).toBe(true);
    expect(holds(inBox("source", "nowhere"), v, { ...subjects, nowhere: undefined })).toBe(false);
  });

  it("reads Live's panels, hover card and inputs as published, never the DOM", () => {
    const v = live({ views: { inputs: true, capacity: false }, readout: { kind: "node", id: "b" } });
    expect(met({ kind: "liveView", view: "inputs", open: true }, v)).toBe(true);
    expect(met({ kind: "liveView", view: "capacity", open: false }, v)).toBe(true);
    expect(met({ kind: "liveView", view: "events", open: true }, v)).toBe(false);
    expect(met({ kind: "liveView", view: "simulations", open: true }, v)).toBe(false);
    expect(met({ kind: "liveView", view: "simulations", open: false }, v)).toBe(false);
    const simulations = { ...v, views: { inputs: false, simulations: true } };
    expect(met({ kind: "liveView", view: "simulations", open: true }, simulations)).toBe(true);
    expect(met({ kind: "liveView", view: "inputs", open: true }, simulations)).toBe(false);
    expect(met({ kind: "readout", subject: "api" }, v)).toBe(true);
    expect(met({ kind: "readout", subject: "app" }, v)).toBe(false);
    expect(met({ kind: "readout" }, v)).toBe(true);
    expect(met({ kind: "readout", subject: "api" }, { ...v, live: false })).toBe(false);
    expect(met({ kind: "inputs", input: "traffic", op: "=", value: 1 }, v)).toBe(true);
    v.session!.inputs = { ...v.session!.inputs, traffic: 3 };
    expect(met({ kind: "inputs", input: "traffic", op: "=", value: 3 }, v)).toBe(true);
    expect(met({ kind: "inputs", input: "traffic", op: ">", value: 3 }, v)).toBe(false);
  });

  it("knows a Fault cleared, an expectation either way, and slow motion finished", () => {
    const v = live();
    const cleared: Check = { kind: "fault", subject: "api", absent: true };
    expect(met(cleared, v)).toBe(true);
    v.session!.snapshot.faults = [{ kind: "slow", node: "b", factor: 5 }];
    expect(met(cleared, v)).toBe(false);
    expect(met(cleared, { ...v, live: false })).toBe(false);
    const chip = (status: "pending" | "pass" | "fail"): SandboxView => ({
      ...v,
      session: {
        ...v.session!,
        running: { id: "sim", title: "Sim", seed: 1, traffic: [] },
        run: { ...run, expectations: [{ id: "ok", label: "OK", status, value: 1 }] },
      } as SandboxView["session"],
    });
    const either: Check = { kind: "expectation", simulation: "sim", label: "ok", outcome: "either" };
    expect(met(either, chip("pending"))).toBe(false);
    expect(met(either, chip("fail"))).toBe(true);
    expect(met(either, chip("pass"))).toBe(true);
    expect(met({ ...either, outcome: undefined }, chip("fail"))).toBe(false);
    expect(met({ ...either, outcome: "fail" }, chip("fail"))).toBe(true);
    const slow = (playing: boolean, t: number): SandboxView => ({
      ...v,
      slowmo: { status: "on", playing, t, script: { duration: 1000 } },
    });
    const finished: Check = { kind: "slowmo", finished: true };
    expect(met(finished, slow(true, 400))).toBe(false);
    expect(met(finished, slow(false, 400)), "paused isn't finished").toBe(false);
    expect(met(finished, slow(false, 1000))).toBe(true);
    expect(met({ kind: "slowmo" }, slow(true, 400))).toBe(true);
  });

  it("finds an authored simulation by what it has: its id, a Drill step, its expectations", () => {
    const drill: Simulation = {
      id: "simulation",
      title: "Mine",
      seed: 1,
      traffic: [],
      timeline: [
        {
          atMs: 1000,
          action: { do: "fault", fault: { kind: "slow", node: "b", factor: 5 }, drill: "slow-dependency" },
        },
      ],
      expectations: [],
    };
    const v = live({ diagram: { ...diagram, simulations: [drill] } });
    expect(met({ kind: "savedSimulation", match: { drill: "any" } }, v)).toBe(true);
    expect(met({ kind: "savedSimulation", match: { drill: "zone-outage" } }, v)).toBe(false);
    expect(met({ kind: "savedSimulation", match: { id: "simulation", expectations: 1 } }, v)).toBe(false);
    const running: SandboxView = { ...v, session: { ...v.session!, running: drill, run } as SandboxView["session"] };
    expect(met({ kind: "simulation", saved: { drill: "slow-dependency" } }, running)).toBe(true);
    expect(met({ kind: "simulation", saved: { drill: "zone-outage" } }, running)).toBe(false);
  });
});
