import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { createEditor, type EditorDeps } from "../../editor/useEditor";
import type { DiagramFile } from "../../model/types";
import { runChecks } from "../run";
import { applyFix, ignoreFinding, turnOff, turnOn, unignore } from "./actions";

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
  it("applies a cached fix once: a second click (or the inspector's button) adds no second queue", () => {
    const d = queue();
    const finding = runChecks(d).findings.find((f) => f.id === "dead-letter:q")!;
    const { api, replace } = editorFor(d);
    expect(applyFix(api, finding)).toBe(true);
    expect(applyFix(api, finding)).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(api.getDiagram().nodes).toHaveLength(4);
  });

  it("sizes a capacity fix from the diagram as it is now, not as the cached check saw it", () => {
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
    expect(applyFix(api, cached)).toBe(false);
    expect(api.getNode("w")?.props?.replicas).toBe(200);
    // Or to not quite enough: the fix applied is worked out now.
    setReplicas(8);
    expect(applyFix(api, cached)).toBe(true);
    expect(api.getNode("w")?.props?.replicas).toBe(19);
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
