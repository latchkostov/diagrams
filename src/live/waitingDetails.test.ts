import { afterEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import * as planning from "../sim/waitingPlan";
import { waitingDetails } from "./waitingDetails";
import { simulationEdges } from "../sim/topology";
import { waitingFixture } from "../lab/waitingFixture";
import type { Simulation } from "../model/types";

afterEach(() => vi.restoreAllMocks());

it("shares one deferred waiting plan across detail views and invalidates either input", () => {
  const diagram: DiagramFile = {
    format: "diagrams/v2",
    title: "Waiting",
    planning: { revision: "p3-w1" },
    nodes: [
      { id: "a", stencil: "service.dotnet", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.dotnet", label: "B", x: 300, y: 0 },
    ],
    edges: [{ id: "request", from: "a", to: "b", kind: "sync" }],
  };
  const configuration = {};
  const compute = vi.spyOn(planning, "waitingPlan");
  expect(compute).not.toHaveBeenCalled();
  const first = waitingDetails(diagram, configuration)!;
  expect(waitingDetails(diagram, configuration)?.nodes.get("b")).toBe(first.nodes.get("b"));
  expect(waitingDetails(diagram, configuration)).toBe(first);
  expect(compute).toHaveBeenCalledTimes(1);
  const edited = { a: { concurrency: 2 } };
  expect(waitingDetails(diagram, edited)).not.toBe(first);
  expect(waitingDetails({ ...diagram }, edited)).not.toBe(first);
  expect(compute).toHaveBeenCalledTimes(3);
  expect(waitingDetails({ ...diagram, planning: undefined }, configuration)).toBeUndefined();
  expect(compute).toHaveBeenCalledTimes(3);
});

it("keeps one effective waiting plan across remounted hovers with simulation overrides", () => {
  const diagram = waitingFixture();
  const simulation: Simulation = {
    id: "run",
    title: "Run",
    traffic: [],
    setup: { edges: { call: { caller: { wait: "non-blocking" } } } },
  };
  const configuration = {};
  const compute = vi.spyOn(planning, "waitingPlan");
  const first = waitingDetails(simulationEdges(diagram, simulation), configuration);
  expect(waitingDetails(simulationEdges(diagram, { ...simulation }), configuration)).toBe(first);
  expect(compute).toHaveBeenCalledTimes(1);
  const edited = { ...simulation, setup: { edges: { call: { caller: { wait: "blocking" as const } } } } };
  expect(waitingDetails(simulationEdges(diagram, edited), configuration)).not.toBe(first);
  expect(compute).toHaveBeenCalledTimes(2);
});

it("skips retry-budget capacity analysis above the planning work ceiling, keeping the waiting plan", async () => {
  const capacity = await import("../sim/capacity");
  const { planningSignature } = await import("../planning/budget");
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 30, jitter: 0, failureRate: 1 };
  d.edges[1].props = {
    travelMs: 10,
    caller: {
      wait: "blocking",
      deadlineMs: 200,
      retry: {
        maxAttempts: 3,
        backoffMs: 100,
        strategy: "fixed",
        retryOn: ["transient"],
        budget: { percent: 20, minPerSec: 10 },
      },
    },
  };
  // Within the node and edge caps, but many message types and a broker fan-out make the solver's work too large.
  d.nodes.push({ id: "bus", stencil: "generic.queue", label: "Bus", x: 0, y: 600 });
  for (let i = 0; i < 120; i++) {
    d.nodes.push({
      id: `s${i}`,
      stencil: "client.user",
      label: `Type ${i}`,
      x: 0,
      y: 0,
      props: { messageType: `T${i}` },
    });
    d.edges.push({ id: `s${i}-bus`, from: `s${i}`, to: "bus" });
  }
  d.edges.push({ id: "bus-caller", from: "bus", to: "caller" }, { id: "caller-bus", from: "caller", to: "bus" });
  expect(d.nodes.length).toBeLessThanOrEqual(256);
  expect(d.edges.length).toBeLessThanOrEqual(512);
  expect(planningSignature(d)).toBeUndefined();
  const analyze = vi.spyOn(capacity, "analyzeCapacity");
  const plan = waitingDetails(d, {})!;
  expect(analyze).not.toHaveBeenCalled();
  expect(plan.amplification.get("call")?.policy.budget).toEqual({ percent: 20, minPerSec: 10 });
  expect(plan.nodes.get("caller")?.callMs).toBeGreaterThan(0);
});
