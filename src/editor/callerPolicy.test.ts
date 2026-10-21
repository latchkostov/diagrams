import { expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { LiveController } from "../live/controller";
import { effectiveCallerPolicy } from "./callerPolicy";
import type { EditorApi } from "./types";
import { LiveSync } from "../live/session/liveSync";
import { checkJsonSchema } from "../model/jsonSchema";
import { callerSchema } from "../model/admissionSchema";

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

it("withholds caller edits on a changed draft sharing its saved simulation ID", () => {
  const diagram = waitingFixture();
  const saved = {
    id: "run",
    title: "Run",
    durationMs: 1000,
    traffic: [],
    setup: { edges: { call: { caller: { wait: "blocking" as const } } } },
  };
  diagram.simulations = [saved];
  const draft = { ...saved, durationMs: 9000 };
  const controller = new LiveController(diagram, { replayDelayMs: 0 });
  controller.selectSimulation(draft);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn(),
    setEdgeProps: vi.fn(),
  };
  const effective = effectiveCallerPolicy(editor, "call", { controller, slowmo: { active: false } })!;
  expect(effective.editable).toBe(false);
  effective.set({ wait: "non-blocking" });
  expect(editor.updateMeta).not.toHaveBeenCalled();
  expect(editor.setEdgeProps).not.toHaveBeenCalled();
  expect(controller.getState().simulation).toEqual(draft);
  expect(controller.getState().running?.durationMs).toBe(9000);
  controller.dispose();
});

it("clearing saved caller overrides inherits diagram values before and after reload", () => {
  const diagram = waitingFixture();
  diagram.edges[1].props!.caller = { poolConnections: 2, replyMs: 30 };
  const simulation = {
    id: "run",
    title: "Run",
    traffic: [],
    setup: { edges: { call: { caller: { poolConnections: 4, replyMs: 100 } } } },
  };
  diagram.simulations = [simulation];
  const controller = new LiveController(diagram, { replayDelayMs: 0 });
  controller.selectSimulation(simulation);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    setEdgeProps: vi.fn(),
  };
  const live = { controller, slowmo: { active: false } };
  effectiveCallerPolicy(editor, "call", live)!.set({ poolConnections: undefined, replyMs: undefined });
  const caller = effectiveCallerPolicy(editor, "call", live)!.caller;
  expect(caller).toMatchObject({ poolConnections: 2, replyMs: 30 });
  expect(diagram.simulations[0].setup!.edges!.call.caller).toEqual({});
  expect(JSON.parse(JSON.stringify(diagram.simulations[0]))).toEqual(diagram.simulations[0]);
  controller.dispose();
});

it("persists an explicit no-timeout override separately from inheriting the diagram deadline", () => {
  const diagram = waitingFixture();
  diagram.edges[1].props!.caller = { deadlineMs: 600 };
  diagram.edges[1].props!.networkDelayMs = 400;
  const simulation = {
    id: "run",
    title: "Run",
    traffic: [],
    setup: { edges: { call: { caller: { deadlineMs: 100 } } } },
  };
  diagram.simulations = [simulation];
  const controller = new LiveController(diagram, { replayDelayMs: 0 });
  controller.selectSimulation(simulation);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    setEdgeProps: vi.fn(),
  };
  const live = { controller, slowmo: { active: false } };
  effectiveCallerPolicy(editor, "call", live)!.set({ deadlineMs: undefined });
  expect(effectiveCallerPolicy(editor, "call", live)!.policy.deadlineMs).toBeUndefined();
  const saved = JSON.parse(JSON.stringify(diagram.simulations[0])) as typeof simulation;
  expect(saved.setup.edges.call.caller).toEqual({ deadlineMs: null });
  expect(checkJsonSchema(saved.setup.edges.call.caller, callerSchema)).toBeUndefined();
  controller.selectSimulation(saved);
  expect(effectiveCallerPolicy(editor, "call", live)!.policy.deadlineMs).toBeUndefined();
  controller.inject("source", 1);
  controller.step(2000);
  expect(controller.getState().snapshot.edges.call.calls).toMatchObject({ timedOut: 0 });
  expect(controller.getState().snapshot.nodes.caller.processed).toBe(1);
  controller.selectSimulation({ ...saved, setup: { edges: { call: { caller: {} } } } });
  expect(effectiveCallerPolicy(editor, "call", live)!.policy.deadlineMs).toBe(600);
  controller.dispose();
});

it("shares caller-policy edits through base ops and keeps document sync following-aware", () => {
  const diagram = waitingFixture();
  const simulation = {
    id: "run",
    title: "Run",
    traffic: [],
    setup: { edges: { call: { caller: { wait: "blocking" as const } } } },
  };
  diagram.simulations = [simulation];
  const host = new LiveController(diagram, { replayDelayMs: 0 });
  const follower = new LiveController(structuredClone(diagram), { replayDelayMs: 0 });
  host.selectSimulation(simulation);
  follower.selectSimulation(simulation);
  const hostSync = new LiveSync(host),
    followerSync = new LiveSync(follower);
  followerSync.setFollowing(true);
  const origins: string[] = [];
  host.onOp((entry, origin) => {
    origins.push(`${entry.op.kind}:${origin}`);
    if (entry.op.kind === "base") follower.applyRemote(entry);
  });
  follower.onOp((entry, origin) => origins.push(`${entry.op.kind}:${origin}`));
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    setEdgeProps: vi.fn(),
  };
  effectiveCallerPolicy(editor, "call", { controller: host, slowmo: { active: false } })!.set({
    wait: "non-blocking",
    poolConnections: 2,
    deadlineMs: 150,
  });
  hostSync.simulations(diagram.simulations!, () => undefined);
  followerSync.simulations(diagram.simulations!, () => undefined);
  expect(origins).toEqual(["base:user", "base:remote"]);
  expect(follower.getState().running).toEqual(host.getState().running);
  followerSync.setFollowing(false);
  expect(origins).toEqual(["base:user", "base:remote"]);
  host.inject("source", 8);
  follower.inject("source", 8);
  host.step(100);
  follower.step(100);
  expect(follower.getState().snapshot).toEqual(host.getState().snapshot);
  expect(host.getState().snapshot.edges.call.calls?.inFlight).toBe(2);
  host.step(1000);
  follower.step(1000);
  expect(host.getState().snapshot.edges.call.calls?.timedOut).toBeGreaterThan(0);
  expect(follower.getState().snapshot).toEqual(host.getState().snapshot);
  host.dispose();
  follower.dispose();
});

it("creates a saved simulation override even when the edge inherited its diagram policy", () => {
  const diagram = waitingFixture();
  const simulation: import("../model/types").Simulation = { id: "run", title: "No overrides", traffic: [] };
  diagram.simulations = [simulation];
  const controller = new LiveController(diagram);
  controller.selectSimulation(simulation);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    setEdgeProps: vi.fn(),
  };
  const effective = effectiveCallerPolicy(editor, "call", { controller, slowmo: { active: false } })!;
  expect(effective.simulation).toBe("No overrides");
  effective.set({ deadlineMs: 600 });
  expect(editor.updateMeta).toHaveBeenCalledTimes(1);
  expect(editor.setEdgeProps).not.toHaveBeenCalled();
  expect(diagram.simulations[0].setup?.edges?.call.caller).toEqual({ deadlineMs: 600 });
  expect(controller.getState().running?.setup?.edges?.call.caller).toEqual({ deadlineMs: 600 });
  controller.dispose();
});
