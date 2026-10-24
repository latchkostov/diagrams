/* eslint-disable local/no-literal-ui-text -- Diagram labels in these fixtures are test inputs, not UI copy. */
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import { initialEditorMode } from "../canvas/interaction/mode";
import type { DiagramFile } from "../model/types";
import { holds, nearMiss, resolveSubjects, type SandboxView } from "./checks";
import { mobileApi } from "./catalog/mobileApi";
import type { Check } from "./types";

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
