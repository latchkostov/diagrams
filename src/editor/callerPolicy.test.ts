import { expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { breakerFixture } from "../lab/resilienceFixture";
import { LiveController } from "../live/controller";
import { effectiveCallerPolicy } from "./callerPolicy";
import type { EditorApi } from "./types";
import { LiveSync } from "../live/session/liveSync";
import { checkJsonSchema } from "../model/jsonSchema";
import { callerSchema } from "../model/admissionSchema";
import type { EdgeSimProps } from "../sim/types";
import { commit, createHistory, present, redo, undo } from "./history";
import { recommendedRetry } from "../sim/resiliencePresets";

it("request controls read the current render before the imperative store catches up", () => {
  const previous = waitingFixture();
  const rendered = structuredClone(previous);
  rendered.edges[1].props = { caller: { wait: "non-blocking", breaker: { failurePercent: 35 } } };
  const editor = {
    getDiagram: () => previous,
    getEdge: (id: string) => previous.edges.find((e) => e.id === id),
    getNode: (id: string) => previous.nodes.find((n) => n.id === id),
    updateMeta: vi.fn(),
    setEdgeProps: vi.fn(),
  };
  const current = effectiveCallerPolicy(editor, "call", null, rendered)!;
  expect(current.policy.blocking).toBe(false);
  expect(current.caller.breaker).toEqual({ failurePercent: 35 });
  current.set({ breaker: { ...current.caller.breaker, minimumCalls: 12 } });
  expect(editor.setEdgeProps).toHaveBeenCalledWith(
    "call",
    { caller: { wait: "non-blocking", breaker: { failurePercent: 35, minimumCalls: 12 } } },
    undefined,
  );
});

it.each([false, true])("reselection preserves every tuned caller field without a write (saved=%s)", (saved) => {
  const diagram = waitingFixture();
  const caller = {
    wait: "non-blocking",
    poolConnections: 7,
    replyMs: 43,
    deadlineMs: 789,
    retry: {
      maxAttempts: 5,
      backoffMs: 321,
      strategy: "fixed",
      maxBackoffMs: 4567,
      jitter: 0.5,
      retryOn: ["timeout", "transient"],
      idempotent: true,
      budget: { percent: 37, minPerSec: 3 },
    } satisfies Required<import("../model/admission").RetryPolicy>,
    breaker: {
      failurePercent: 42,
      slowCallMs: 678,
      slowPercent: 54,
      windowMs: 3000,
      minimumCalls: 11,
      openMs: 2345,
      halfOpenCalls: 7,
    } satisfies Required<import("../model/admission").BreakerPolicy>,
  } satisfies EdgeSimProps["caller"];
  diagram.edges[1].props = { caller: saved ? { deadlineMs: 100 } : caller };
  diagram.simulations = [{ id: "run", title: "Tuned", traffic: [], setup: { edges: { call: { caller } } } }];
  const controller = new LiveController(diagram);
  if (saved) controller.selectSimulation(diagram.simulations[0]);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn(),
    setEdgeProps: vi.fn(),
  };
  const live = saved ? { controller, slowmo: { active: false } } : null;
  try {
    // Exercise the setter's normalization boundary with fresh objects, as controlled fields do.
    for (const [key, value] of Object.entries(caller)) {
      effectiveCallerPolicy(editor, "call", live)!.set({ [key]: structuredClone(value) });
      expect(effectiveCallerPolicy(editor, "call", live)!.caller).toEqual(caller);
    }
    expect(editor.setEdgeProps).not.toHaveBeenCalled();
    expect(editor.updateMeta).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

it.each(["none", "first", "both"])("caller history coalesces only explicit matching tags (%s)", (tagged) => {
  const diagram = breakerFixture();
  const original = structuredClone(diagram.edges[1].props!.caller as EdgeSimProps["caller"]);
  let history = createHistory(JSON.stringify(original), original);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn(),
    setEdgeProps: vi.fn<EditorApi["setEdgeProps"]>((id, patch, options) => {
      Object.assign(diagram.edges.find((e) => e.id === id)!.props!, patch);
      const next = structuredClone(patch.caller as EdgeSimProps["caller"]);
      history = commit(history, { key: JSON.stringify(next), value: next, mergeKey: options?.merge, at: 1 });
    }),
  };
  effectiveCallerPolicy(editor, "call", null)!.set(
    { retry: { ...original!.retry!, backoffMs: 321 } },
    tagged !== "none" ? { merge: "inspector:edge:call:retry-backoff" } : undefined,
  );
  const retryTuned = structuredClone(diagram.edges[1].props!.caller as EdgeSimProps["caller"]);
  effectiveCallerPolicy(editor, "call", null)!.set(
    { breaker: { ...original!.breaker, openMs: 2345 } },
    tagged === "both" ? { merge: "inspector:edge:call:retry-backoff" } : undefined,
  );
  const tuned = structuredClone(diagram.edges[1].props!.caller as EdgeSimProps["caller"]);
  expect(history.index).toBe(tagged === "both" ? 1 : 2);
  expect(present(undo(history)).value).toEqual(tagged === "both" ? original : retryTuned);
  if (tagged !== "both") expect(present(undo(undo(history))).value).toEqual(original);
  expect(present(redo(undo(history))).value).toEqual(tuned);
  // Separately flushed timeout edits retain their existing, independent Undo steps.
  effectiveCallerPolicy(editor, "call", null)!.set({ deadlineMs: 789 });
  effectiveCallerPolicy(editor, "call", null)!.set({ deadlineMs: 890 });
  expect(present(undo(history)).value).toEqual({ ...tuned, deadlineMs: 789 });
});

it.each([undefined, {}])("new resilience policies still receive their defaults (caller=%j)", (caller) => {
  const diagram = waitingFixture();
  diagram.edges[1].props = { caller };
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn(),
    setEdgeProps: vi.fn<EditorApi["setEdgeProps"]>((id, patch) => {
      Object.assign(diagram.edges.find((e) => e.id === id)!.props!, patch);
    }),
  };
  const retry = recommendedRetry("GET");
  effectiveCallerPolicy(editor, "call", null)!.set({ retry });
  effectiveCallerPolicy(editor, "call", null)!.set({ breaker: {} });
  expect(editor.setEdgeProps).toHaveBeenCalledTimes(2);
  expect(effectiveCallerPolicy(editor, "call", null)!.caller).toEqual({ retry, breaker: {} });
});

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
  const options = { merge: "inspector:edge:call:wait" };
  effective.set({ wait: "non-blocking" }, options);
  expect(updateMeta).toHaveBeenCalledTimes(saved ? 1 : 0);
  if (saved) expect(updateMeta.mock.calls[0][1]).toBe(options);
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

it("a saved simulation persists Off over a diagram breaker and can turn it back On", () => {
  const diagram = waitingFixture();
  diagram.planning!.revision = "p3-w2";
  diagram.nodes[2].props = { replicas: 1, concurrency: 10, latencyMs: 30, jitter: 0, failureRate: 1 };
  diagram.edges[1].props = { caller: { breaker: { minimumCalls: 1, openMs: 5000 } } };
  diagram.simulations = [{ id: "run", title: "Override", traffic: [] }];
  const controller = new LiveController(diagram, { replayDelayMs: 0 });
  controller.selectSimulation(diagram.simulations[0]);
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    setEdgeProps: vi.fn(),
  };
  const live = { controller, slowmo: { active: false } };
  effectiveCallerPolicy(editor, "call", live)!.set({ breaker: undefined });
  const saved = JSON.parse(JSON.stringify(diagram.simulations[0])) as import("../model/types").Simulation;
  expect(saved.setup?.edges?.call.caller?.breaker).toBeNull();
  expect(() => checkJsonSchema(saved.setup?.edges?.call.caller, callerSchema)).not.toThrow();
  controller.selectSimulation(saved);
  expect(effectiveCallerPolicy(editor, "call", live)!.caller.breaker).toBeNull();
  controller.inject("source", 4);
  controller.step(1000);
  expect(controller.getState().snapshot.edges.call.breaker).toBeUndefined();
  effectiveCallerPolicy(editor, "call", live)!.set({ breaker: { minimumCalls: 1 } });
  controller.inject("source", 4);
  controller.step(1000);
  expect(controller.getState().snapshot.edges.call.breaker?.state).toBe("open");
  expect(diagram.edges[1].props?.caller).toEqual({ breaker: { minimumCalls: 1, openMs: 5000 } });
  expect(editor.setEdgeProps).not.toHaveBeenCalled();
  controller.dispose();
});
