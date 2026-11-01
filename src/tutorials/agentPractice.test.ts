/* eslint-disable local/no-literal-ui-text -- Authored public test diagrams. */
import { afterEach, expect, it, vi } from "vitest";
import { toFlow } from "../canvas/convert";
import type { CanvasSnapshot } from "../editor/useHistory";
import { HistoryController } from "../editor/historyController";
import { editorHarness } from "../test/editorHarness";
import { reviewAgentChanges } from "./catalog/reviewAgentChanges";
import { agentPractice, resetAgentPractice } from "./agentPractice";
import { holds, resolveSubjects } from "./checks";
import { threads } from "../ai/ui/threadStore";
import { observationPorts } from "../lib/observations";
import { paletteHost } from "../palette/host";
import type { DiagramFile } from "../model/types";

afterEach(() => vi.restoreAllMocks());
const start = () => {
  if (typeof reviewAgentChanges.start !== "function") throw new Error("Inline fixture expected");
  return reviewAgentChanges.start();
};
function practice(initial: DiagramFile = start()) {
  const h = editorHarness(initial);
  const history = new HistoryController(toFlow(initial), 0);
  const apply = (snapshot: CanvasSnapshot) => {
    h.setNodes(snapshot.nodes);
    h.deps.setEdges(snapshot.edges);
    h.deps.meta = snapshot.meta;
    h.commit();
  };
  h.deps.history = {
    ...h.deps.history,
    top: () => history.top(),
    replace: (next, merge, before, reset) => {
      history.replace(before ?? toFlow(h.api.getDiagram()), undefined, next, merge, { nodes: [], edges: [] }, 0, reset);
      apply(next);
    },
    undo: () => {
      const snapshot = history.step("undo", { nodes: [], edges: [] });
      if (snapshot) apply(snapshot);
    },
  };
  h.deps.setMeta = (meta) => {
    h.deps.meta = typeof meta === "function" ? meta(h.deps.meta) : meta;
    h.commit();
  };
  const documentId = "example:tutorial-regression";
  resetAgentPractice(documentId);
  vi.spyOn(paletteHost, "get").mockReturnValue({ canvas: { documentId, editor: h.api } } as unknown as ReturnType<
    typeof paletteHost.get
  >);
  return {
    h,
    documentId,
    run: (action: "add" | "undo") => {
      agentPractice(h.api, documentId, action);
      h.commit();
    },
  };
}

it("assisted Undo restores an updated learner worker and preserves unrelated wiring and later edits", () => {
  const initial: DiagramFile = {
    ...start(),
    nodes: [
      ...start().nodes,
      { id: "learner", stencil: "service.go", label: "Learner worker", x: 300, y: 0, props: { replicas: 3 } },
    ],
    edges: [
      { id: "existing-flow", from: "api", to: "learner", kind: "async" },
      { id: "unrelated", from: "learner", to: "api", kind: "sync", label: "Learner wiring" },
    ],
  };
  const { h, documentId, run } = practice(initial);
  run("add");
  expect(threads.get(documentId)[0].before?.nodes).toEqual(initial.nodes);
  expect(h.api.getDiagram().nodes.find((n) => n.id === "learner")?.label).toBe("Status worker");
  expect(h.api.getDiagram().edges).toEqual(initial.edges);
  h.api.applyDiagram({
    ...h.api.getDiagram(),
    description: "Later note",
    nodes: h.api.getDiagram().nodes.map((n) => (n.id === "learner" ? { ...n, x: 500 } : n)),
    edges: [...h.api.getDiagram().edges, { id: "later", from: "learner", to: "api", kind: "async" }],
  });
  h.commit();
  run("undo");
  expect(h.api.getDiagram().nodes).toEqual(initial.nodes.map((n) => (n.id === "learner" ? { ...n, x: 500 } : n)));
  expect(h.api.getDiagram().edges).toEqual([
    ...initial.edges,
    { id: "later", from: "learner", to: "api", kind: "async" },
  ]);
  expect(h.api.getDiagram().description).toBe("Later note");
  expect(observationPorts.ai.get()?.kind).toBe("undo");
  const undo = reviewAgentChanges.steps.find((step) => step.id === "undo")!.check;
  const view = { diagram: h.api.getDiagram(), live: false, processed: () => 0 };
  const subjects = resolveSubjects(reviewAgentChanges, view.diagram);
  expect(holds(undo, view, subjects)).toBe(false);
  expect(holds(undo, { ...view, observations: { ai: observationPorts.ai.get()! } }, subjects)).toBe(true);
});

it("assisted Undo removes only the added worker after a later learner edit", () => {
  const { h, run } = practice();
  run("add");
  h.api.applyDiagram({ ...h.api.getDiagram(), description: "Keep this note" });
  h.commit();
  run("undo");
  expect(h.api.getDiagram().nodes).toEqual(start().nodes);
  expect(h.api.getDiagram().edges).toEqual([]);
  expect(h.api.getDiagram().description).toBe("Keep this note");
});

it("assisted Undo acknowledges an addition already undone in the toolbar without throwing", () => {
  const { h, documentId, run } = practice();
  run("add");
  h.api.undo();
  h.commit();
  expect(h.api.getDiagram().nodes).toEqual(start().nodes);
  expect(() => run("undo")).not.toThrow();
  expect(h.api.getDiagram().nodes).toEqual(start().nodes);
  expect(threads.get(documentId)[0].undone).toBe(true);
  expect(observationPorts.ai.get()).toMatchObject({ kind: "undo", documentId });
});

it("an equivalent existing worker remains intact through assisted Apply and Undo", () => {
  const { h, run } = practice();
  run("add");
  const initial = h.api.getDiagram();
  run("add");
  const worker = initial.nodes.find((n) => n.stencil === "service.go")!;
  expect(h.api.getDiagram().nodes).toEqual(initial.nodes);
  expect(h.api.getDiagram().edges).toEqual(initial.edges);
  expect(observationPorts.ai.get()).toMatchObject({ kind: "change", changed: [worker.id] });
  const view = {
    diagram: h.api.getDiagram(),
    live: false,
    processed: () => 0,
    observations: { ai: observationPorts.ai.get()! },
  };
  expect(
    holds(
      reviewAgentChanges.steps.find((step) => step.id === "apply")!.check,
      view,
      resolveSubjects(reviewAgentChanges, view.diagram),
    ),
  ).toBe(true);
  h.api.applyDiagram({ ...h.api.getDiagram(), description: "Later note" });
  h.commit();
  run("undo");
  expect(h.api.getDiagram().nodes).toEqual(initial.nodes);
  expect(h.api.getDiagram().edges).toEqual(initial.edges);
});
