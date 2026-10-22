import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { createEditor, type EditorDeps } from "../../editor/useEditor";
import type { DiagramFile } from "../../model/types";
import { runChecks } from "../run";
import { applyFix, ignoreFinding, turnOff, turnOn, unignore } from "./actions";
import * as simulation from "../../sim/simulation";
import { planScaling } from "../../sim/scalingPlanner";
import { registerScenarioPlanner, rememberPlans } from "../../lib/scenarioPlanner";
import { plannerFixture } from "../../lab/plannerFixture";
import payment from "../../examples/slow-payment-provider.json";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../../i18n/core";
import * as toast from "../../interop/ui/toast";
import { registerRequestChecks, rememberedRequestChecks, awaitRequestChecks } from "../../lib/requestCheckCache";
import { runChecksOffThread } from "../../canvas/checks/runner";

// A fix from a cached finding is checked again on the diagram as it is now: never applied twice, never sized
// from numbers the diagram has since changed. Each check setting is its own undo step.

function editorFor(diagram: DiagramFile) {
  let flow = toFlow(diagram);
  const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const replace = vi.fn((next: typeof flow) => {
    flow = next;
    editor.updateDeps(rf, { ...deps, meta: flow.meta });
  });
  const hint = vi.fn();
  const deps = {
    meta: flow.meta,
    history: { replace, hint },
    setMeta: (fn: (m: typeof flow.meta) => typeof flow.meta) => {
      flow = { ...flow, meta: fn(flow.meta) };
      editor.updateDeps(rf, { ...deps, meta: flow.meta });
    },
  } as unknown as EditorDeps;
  const editor = createEditor(rf, deps);
  return { api: editor.api, replace, hint };
}

it("worker fallback preserves actionable waiting fixes and disabled findings in the shared cache", async () => {
  vi.stubGlobal("Worker", undefined);
  const d = structuredClone(payment) as DiagramFile;
  d.nodes[0].label = "Fallback shopper";
  d.checks = { off: ["call-timeout"] };
  registerScenarioPlanner(async () => []);
  registerRequestChecks(async () => {
    throw new Error("A later read must hit the fallback cache");
  });
  try {
    await runChecksOffThread(d);
    const all = rememberedRequestChecks(d)!;
    expect(all.find((f) => f.id === "call-timeout:pay")?.fix).toBeDefined();
    expect(await awaitRequestChecks(d)).toBe(all);
    d.checks = undefined;
    const finding = runChecks(d, { rules: ["call-timeout"] }).findings.find((f) => f.id === "call-timeout:pay")!;
    const { api, replace } = editorFor(d);
    expect(await applyFix(api, finding)).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(api.getDiagram().edges.find((e) => e.id === "pay")?.props?.caller).toMatchObject({ deadlineMs: 600 });
  } finally {
    registerRequestChecks(undefined);
    registerScenarioPlanner(undefined);
    vi.unstubAllGlobals();
  }
});

it.each([false, true])("fix rechecks await readiness and reject intervening edits (edit=%s)", async (edit) => {
  const d = structuredClone(payment) as DiagramFile;
  const finding = runChecks(d, { rules: ["call-timeout"] }).findings.find((f) => f.id === "call-timeout:pay")!;
  const { api, replace } = editorFor(d);
  let answer!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => (started = resolve));
  registerRequestChecks(
    () =>
      new Promise((resolve) => {
        answer = () => resolve([finding]);
        started();
      }),
  );
  try {
    const applied = applyFix(api, finding);
    await began;
    expect(replace).not.toHaveBeenCalled();
    if (edit) {
      const current = api.getDiagram();
      api.applyDiagram({
        ...current,
        nodes: current.nodes.map((n) => (n.id === "checkout" ? { ...n, props: { ...n.props, concurrency: 50 } } : n)),
      });
    }
    answer();
    expect(await applied).toBe(!edit);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(api.getDiagram().edges.find((e) => e.id === "pay")?.props?.caller).toMatchObject(
      edit ? {} : { deadlineMs: 600 },
    );
  } finally {
    registerRequestChecks(undefined);
  }
});

const queue = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Q",
  nodes: [
    { id: "api", stencil: "service.node", label: "API", x: 0, y: 0 },
    { id: "q", stencil: "aws.sqs", label: "orders", x: 300, y: 0 },
    { id: "w", stencil: "aws.lambda", label: "Worker", x: 600, y: 0, props: { failureRate: 1 } },
  ],
  edges: [
    { id: "e1", from: "api", to: "q", kind: "async" },
    { id: "e2", from: "q", to: "w", kind: "async" },
  ],
});

describe("applyFix", () => {
  it("applies a cached fix once: a second click (or the inspector's button) adds no second queue", async () => {
    const d = queue();
    const finding = runChecks(d).findings.find((f) => f.id === "dead-letter:q")!;
    const { api, replace } = editorFor(d);
    expect(await applyFix(api, finding)).toBe(true);
    expect(await applyFix(api, finding)).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(api.getDiagram().nodes).toHaveLength(4);
  });

  it("sizes a capacity fix from the diagram as it is now, not as the cached check saw it", async () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Busy",
      nodes: [
        { id: "src", stencil: "client.browser", label: "Shop", x: 0, y: 0, props: { ratePerSec: 100 } },
        { id: "w", stencil: "service.java", label: "Billing", x: 300, y: 0, props: { latencyMs: 100, concurrency: 1 } },
      ],
      edges: [{ id: "e", from: "src", to: "w", kind: "sync" }],
    };
    const cached = runChecks(d).findings.find((f) => f.id === "capacity:w")!;
    expect(cached.fix?.ops).toEqual([{ op: "update", target: "w", props: { replicas: 19 } }]);
    const { api } = editorFor(d);
    const setReplicas = (replicas: number) => {
      const now = api.getDiagram();
      api.applyDiagram({
        ...now,
        nodes: now.nodes.map((n) => (n.id === "w" ? { ...n, props: { ...n.props, replicas } } : n)),
      });
    };
    // Someone sized it by hand meanwhile, to more than enough: nothing left to fix.
    setReplicas(200);
    expect(await applyFix(api, cached)).toBe(false);
    expect(api.getNode("w")?.props?.replicas).toBe(200);
    // Or to not quite enough: the fix applied is worked out now.
    setReplicas(8);
    expect(await applyFix(api, cached)).toBe(true);
    expect(api.getNode("w")?.props?.replicas).toBe(19);
  });
});

describe("applyFix with an option", () => {
  const bypass = (): DiagramFile => ({
    format: "diagrams/v1",
    title: "Bypass",
    nodes: [
      { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 200 },
      { id: "gw", stencil: "nginx", label: "Gateway", x: 300, y: 0 },
      { id: "api", stencil: "service.go", label: "API", x: 600, y: 0 },
    ],
    edges: [
      { id: "e1", from: "web", to: "gw", kind: "sync" },
      { id: "e2", from: "gw", to: "api", kind: "sync" },
      { id: "e3", from: "app", to: "api", kind: "sync" },
    ],
  });

  it("applies the chosen option, worked out now, as one step; an unknown option applies nothing", async () => {
    const d = bypass();
    const cached = runChecks(d).findings.find((f) => f.id === "entry-gateway:api")!;
    expect(cached.fix?.options?.map((o) => o.label)).toEqual([
      "Put Firewall / WAF in front",
      "Put Kong Gateway in front",
    ]);
    const { api, replace } = editorFor(d);
    expect(await applyFix(api, cached, "Put a moat in front")).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(await applyFix(api, cached, "Put Kong Gateway in front")).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    const kong = api.getDiagram().nodes.find((n) => n.stencil === "kong")!;
    expect(kong.label).toBe("Kong Gateway");
    expect(
      api
        .getDiagram()
        .edges.filter((e) => e.to === "api")
        .map((e) => e.from)
        .sort(),
    ).toEqual(["gw", kong.id]);
    // Fixed: a second click (either way) does nothing.
    expect(await applyFix(api, cached, "Put Kong Gateway in front")).toBe(false);
    expect(await applyFix(api, cached)).toBe(false);
  });
});

describe("check settings", () => {
  it("each ignore, turn-off and restore is its own undo step (a tag of its own)", () => {
    const d = queue();
    const finding = runChecks(d).findings.find((f) => f.id === "dead-letter:q")!;
    const { api, hint } = editorFor(d);
    turnOff(api, "capacity", "Can't keep up");
    turnOff(api, "no-reader", "Nobody reads a topic or queue");
    ignoreFinding(api, finding, "  owned by the platform  ");
    unignore(api, "dead-letter", "q");
    turnOn(api, "capacity", "Can't keep up");
    const tags = hint.mock.calls.map((c) => c[0]);
    expect(tags).toHaveLength(5);
    expect(new Set(tags).size).toBe(5);
    expect(tags.every((t) => typeof t === "string" && t.startsWith("check:settings:"))).toBe(true);
    expect(api.getDiagram().checks).toEqual({ off: ["no-reader"] });
  });
});

describe("scenario sizing fixes in the editor", () => {
  it("re-checks and applies from the worker's plans: no simulation runs on this thread", async () => {
    const { api } = editorFor(plannerFixture());
    const current = api.getDiagram();
    const plans = planScaling(current); // what the checks worker worked out
    registerScenarioPlanner(() => Promise.resolve(plans));
    const played = vi.spyOn(simulation, "createSimulationRun");
    try {
      rememberPlans(current, plans);
      const finding = runChecks(current).findings.find((f) => f.id === "capacity:worker")!;
      expect(finding.scalingPlan).toMatchObject({ kind: "max", to: 14 });
      expect(await applyFix(api, finding)).toBe(true);
      // The fixed diagram hasn't been planned off-thread yet: its checks show no sizing until the worker answers.
      expect(runChecks(api.getDiagram()).findings.find((f) => f.id === "capacity:worker")?.scalingPlan).toBeUndefined();
      expect(played).not.toHaveBeenCalled();
    } finally {
      played.mockRestore();
      registerScenarioPlanner(undefined);
    }
  });
});

it("a timeout Check's applied feedback and Undo translate while its ops stay English", async () => {
  const d = payment as DiagramFile;
  const finding = runChecks(d, { rules: ["call-timeout"] }).findings.find((f) => f.target === "pay")!;
  const { api, replace } = editorFor(d);
  const notify = vi.spyOn(toast, "notify");
  try {
    state.l = "ar";
    state.c = (await catalogs.ar()).default as Catalog;
    expect(await applyFix(api, finding)).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    const [text, options] = notify.mock.calls.at(-1)!;
    expect(text).toContain("تم");
    expect(text).not.toContain("Add a 600 ms timeout");
    expect(options?.action?.label).not.toBe("Undo");
    expect(api.getDiagram().edges.find((e) => e.id === "pay")?.props?.caller).toMatchObject({ deadlineMs: 600 });
  } finally {
    notify.mockRestore();
    state.l = "en";
    state.c = undefined;
  }
});
