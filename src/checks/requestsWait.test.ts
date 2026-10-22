import { expect, it, vi } from "vitest";
import busy from "../examples/scale-on-busy-threads.json";
import payment from "../examples/slow-payment-provider.json";
import blocking from "../examples/blocking-call.json";
import type { DiagramFile } from "../model/types";
import { runChecks } from "./run";
import { applyOps, describeDiagram, toolSchemas } from "../ai";
import { checkSchema } from "../ai/validation";
import { confirmedThreadFix } from "../live/threadFixPlan";
import { threadCheckFix } from "./requestFindings";
import { planScaling } from "../sim/scalingPlanner";
import { LiveController } from "../live/controller";
import { TroubleTracker } from "../live/useObservedTrouble";
import { createEditor, type EditorDeps } from "../editor/useEditor";
import { toFlow } from "../canvas/convert";
import type { ReactFlowInstance } from "@xyflow/react";
import type { FlowNode, DiagramFlowEdge } from "../canvas/types";
import { profileOf } from "../stencils/profiles";
import { registerScenarioPlanner } from "../lib/scenarioPlanner";
import { rememberRequestChecks, registerRequestChecks } from "../lib/requestCheckCache";
import * as verification from "../live/threadFixPlan";
import { presentFinding } from "./presentation";

const find = (d: DiagramFile, rule: "blocked-threads" | "scaling-blind" | "call-timeout") =>
  runChecks(d, { rules: [rule] }).findings;

it("the public CPU example's Check, callout and planner have identical primary edits", async () => {
  const d = busy as DiagramFile;
  const blocked = find(d, "blocked-threads")[0];
  expect(blocked?.fix?.label).toBe("Scale on busy threads");
  expect(blocked.fix!.options?.map((o) => o.short)).toEqual(["Free the thread while waiting", "Add replicas"]);
  expect(find(d, "scaling-blind")[0]?.fix?.ops).toEqual(blocked.fix!.ops);
  expect(find(d, "scaling-blind")[0]?.message).toContain("31% CPU against a 70% target");
  expect(presentFinding(find(d, "scaling-blind")[0]).message).toContain("31% CPU against a 70% target");
  const plan = planScaling(d)[0];
  expect(blocked.fix!.ops).toEqual(
    plan.suggestions[0].fix!.map((c) => ({ op: "update", target: c.node, props: c.props })),
  );
  const controller = new LiveController(d);
  const tracker = new TroubleTracker(controller, async (request) => confirmedThreadFix(request));
  const stop = tracker.subscribe(() => {});
  try {
    controller.selectSimulation(d.simulations![0]);
    for (let i = 0; i < 150; i++) controller.step(100);
    await Promise.resolve();
    expect(threadCheckFix(d, tracker.current()?.action)?.ops).toEqual(blocked.fix!.ops);
  } finally {
    stop();
    controller.dispose();
  }
});

it("the merged payment example's timeout matches the callout's verified value", () => {
  const d = payment as DiagramFile;
  const timeout = find(d, "call-timeout").find((f) => f.target === "pay")!;
  const action = confirmedThreadFix({
    context: {
      revision: 0,
      origin: { diagram: d, simulation: d.simulations![0], initialTraffic: false },
      controls: [],
    },
    time: 15000,
    trouble: {
      key: "threads-exhausted:checkout",
      kind: "threads-exhausted",
      node: "checkout",
      headline: "",
      announce: "",
      detail: "",
      action: { kind: "add-timeout", edge: "pay", deadlineMs: 600 },
    },
  });
  expect(action).toEqual({ kind: "add-timeout", edge: "pay", deadlineMs: 600 });
  expect(timeout.fix!.ops).toEqual(threadCheckFix(d, action)?.ops);
  expect(find(d, "blocked-threads")).toEqual([]); // The normal provider fits; its drill supplies the slowdown.
});

it("the merged payment example also shares the verified blocked-thread fix when normal traffic exhausts it", async () => {
  const d = structuredClone(payment) as DiagramFile;
  d.nodes.find((n) => n.id === "shop")!.props!.ratePerSec = 600;
  d.nodes.find((n) => n.id === "shop")!.props!.trafficMix = {
    mode: "rates",
    entries: [
      { routeId: "checkout", ratePerSec: 600 },
      { routeId: "status", ratePerSec: 20 },
    ],
  };
  d.edges.reverse(); // A fast database call must not hide the payment call that holds the threads.
  const check = find(d, "blocked-threads")[0];
  expect(check.fix?.label).toBe("Free the thread while waiting");
  const controller = new LiveController(d);
  const tracker = new TroubleTracker(controller, async (request) => confirmedThreadFix(request));
  const stop = tracker.subscribe(() => {});
  try {
    controller.setTraffic(true);
    for (let i = 0; i < 150; i++) controller.step(100);
    await Promise.resolve();
    expect(threadCheckFix(d, tracker.current()?.action)?.ops).toEqual(check.fix!.ops);
  } finally {
    stop();
    controller.dispose();
  }
});

it("main-thread rechecks reuse the worker's exact findings and never verify a simulation", () => {
  const d = busy as DiagramFile;
  const expected = runChecks(d);
  registerScenarioPlanner(async () => []);
  registerRequestChecks(async () => []);
  const replay = vi.spyOn(verification, "confirmedThreadFix");
  try {
    rememberRequestChecks(d, [...expected.findings, ...expected.ignored]);
    expect(find(d, "blocked-threads")).toEqual(expected.findings.filter((f) => f.rule === "blocked-threads"));
    expect(replay).not.toHaveBeenCalled();
    const edited = structuredClone(d);
    edited.edges.find((e) => e.id === "call")!.props!.caller = { wait: "non-blocking" };
    expect(() => find(edited, "blocked-threads")).toThrow("pending");
    expect(replay).not.toHaveBeenCalled();
  } finally {
    replay.mockRestore();
    registerScenarioPlanner(undefined);
    registerRequestChecks(undefined);
  }
});

it.each(["blocked-threads", "scaling-blind", "call-timeout"] as const)(
  "%s fixes in one editor history step and clears its finding",
  (rule) => {
    const d = structuredClone(rule === "call-timeout" ? payment : busy) as DiagramFile;
    const finding = find(d, rule)[0];
    expect(finding?.fix?.ops).toBeDefined();
    const result = applyOps(d, finding.fix!.ops!);
    expect(result.errors).toEqual([]);
    let flow = toFlow(d);
    const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<
      FlowNode,
      DiagramFlowEdge
    >;
    const replace = vi.fn((next: typeof flow) => {
      flow = next;
    });
    const editor = createEditor(rf, { meta: flow.meta, history: { replace } } as unknown as EditorDeps);
    editor.api.applyDiagram(result.diagram);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(find(result.diagram, rule).map((f) => f.id)).not.toContain(finding.id);
  },
);

it("freeing threads is the primary fix without a scaler; healthy and older diagrams do not warn", () => {
  const d = structuredClone(blocking) as DiagramFile;
  d.nodes.find((n) => n.id === "caller")!.props!.autoscaling = { mode: "off" };
  expect(find(d, "blocked-threads")[0]?.fix?.label).toBe("Free the thread while waiting");
  d.planning = { revision: "p3-a1" };
  for (const rule of ["blocked-threads", "scaling-blind", "call-timeout"] as const) expect(find(d, rule)).toEqual([]);
});

it("outside and model API families have deadlines; dependencies, messages and authored timeouts do not warn", () => {
  const d = structuredClone(payment) as DiagramFile;
  d.edges.find((e) => e.id === "pay")!.props = { caller: { deadlineMs: 600 } };
  expect(find(d, "call-timeout")).toEqual([]);
  d.edges.find((e) => e.id === "pay")!.props = {};
  d.edges.find((e) => e.id === "pay")!.kind = "async";
  expect(find(d, "call-timeout")).toEqual([]);
  expect(profileOf("generic.llm")?.family).toBe("model-api");
  d.edges.find((e) => e.id === "pay")!.kind = "sync";
  d.nodes.find((n) => n.id === "payment")!.stencil = "generic.llm";
  expect(find(d, "call-timeout").map((f) => f.target)).toEqual(["pay"]);
});

it("agent describe exposes thread count, hold time and ceiling; schemas accept all new checks", () => {
  const d = blocking as DiagramFile;
  const json = JSON.parse(describeDiagram(d, { format: "json" })) as {
    nodes: { id: string; requestsWait?: unknown }[];
  };
  expect(json.nodes.find((n) => n.id === "caller")?.requestsWait).toEqual({
    threads: 64,
    holdMs: 260,
    ceilingPerSec: 64000 / 260,
  });
  expect(describeDiagram(d)).toContain("requestsWait=");
  expect(() =>
    checkSchema({ rules: ["blocked-threads", "scaling-blind", "call-timeout"] }, toolSchemas.check_diagram),
  ).not.toThrow();
});

it("sync loops warn about held-thread deadlock only without a deadline or freed call", () => {
  const d = structuredClone(payment) as DiagramFile;
  d.edges = [{ id: "loop", from: "checkout", to: "checkout", kind: "sync" }];
  const message = () => runChecks(d, { rules: ["sync-cycle"] }).findings[0].message;
  expect(message()).toContain("deadlocked");
  d.edges[0].props = { caller: { deadlineMs: 600 } };
  expect(message()).not.toContain("deadlocked");
  d.edges[0].props = { caller: { wait: "non-blocking" } };
  expect(message()).not.toContain("deadlocked");
});
