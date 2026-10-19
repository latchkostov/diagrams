import { expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { LiveController } from "../live/controller";
import { effectiveCallerPolicy } from "./callerPolicy";
import type { EditorApi } from "./types";

it.each([true, false])("edits a saved override once and withholds an unsaved override (saved=%s)", (saved) => {
  const diagram = waitingFixture();
  const simulation = {
    id: "run",
    title: "Run",
    traffic: [],
    setup: { edges: { call: { caller: { wait: "blocking" as const } } } },
  };
  diagram.edges[1].props = { caller: { wait: "non-blocking", replyMs: 30 } };
  if (saved) diagram.simulations = [simulation];
  const controller = new LiveController(diagram, { replayDelayMs: 0 });
  controller.selectSimulation(simulation);
  const updateMeta = vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch));
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta,
    setEdgeProps: vi.fn(),
  };
  const effective = effectiveCallerPolicy(editor, "call", { controller, slowmo: { active: false } })!;
  expect(effective.policy.blocking).toBe(true);
  expect(effective.caller.replyMs).toBe(30);
  expect(effective.editable).toBe(saved);
  effective.set({ wait: "non-blocking" });
  expect(updateMeta).toHaveBeenCalledTimes(saved ? 1 : 0);
  expect(editor.setEdgeProps).not.toHaveBeenCalled();
  expect(controller.getState().running?.setup?.edges?.call.caller?.wait).toBe(saved ? "non-blocking" : "blocking");
  expect(diagram.edges[1].props?.caller).toEqual({ wait: "non-blocking", replyMs: 30 });
  controller.dispose();
});
