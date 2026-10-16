import { describe, it, expect } from "vitest";
import { planScaling, planWork, PLANNER_LIMITS } from "./scalingPlanner";
import { plannerFixture } from "../lab/plannerFixture";
import type { DiagramFile } from "../model/types";
import type { AppServiceController, AutoscalingConfig } from "../model/autoscaling";
import { cloudFixture } from "../lab/cloudFixture";

const plan = (d: DiagramFile) => planScaling(structuredClone(d))[0];

describe("scenario sizing planner", () => {
  it("reproduces 3× / max 10 / 92% / target 70% → max 14, verified by a same-seed rerun", () => {
    const p = plan(plannerFixture());
    expect(p).toMatchObject({ simulation: "black-friday", traffic: 3, status: "planned" });
    const [s] = p.suggestions;
    expect(s).toMatchObject({ node: "worker", adapter: "hpa", kind: "max", from: 10, to: 14, wanted: 14, target: 70 });
    expect(s.metric).toBeGreaterThan(91);
    expect(s.metric).toBeLessThanOrEqual(92.5);
    expect(s.verified?.maxed).toBe(false);
    const a = s.fix![0].props.autoscaling as AutoscalingConfig & { mode: "on" };
    expect(a.controller.maxReplicas).toBe(14);
    expect(p.runs).toBe(2);
  });
  it("replaces a max fix with partitions when the input's partitions bound the useful readers", () => {
    const p = plan(plannerFixture("partitions", 60));
    expect(p.suggestions[0]).toMatchObject({ kind: "partitions", broker: "orders", from: 10 });
    expect(p.suggestions[0].to).toBeGreaterThan(10);
    expect(p.suggestions[0].fix![0]).toEqual({ node: "orders", props: { partitions: p.suggestions[0].to } });
    expect(p.suggestions[0].verified!.endBacklog).toBeLessThan(p.suggestions[0].endBacklog);
  });
  it("offers no replica fix when an admission quota binds", () => {
    const p = plan(plannerFixture("quota", 60));
    expect(p.suggestions[0]).toMatchObject({ kind: "quota" });
    expect(p.suggestions[0].fix).toBeUndefined();
    expect(p.suggestions[0].verified!.rejected).toBeGreaterThan(0);
  });
  it("suggests a warm minimum only when a backlog goal fails while replicas start", () => {
    const d = plannerFixture("http", 10);
    expect(plan(d).suggestions).toEqual([]);
    d.simulations![0].expectations = [
      {
        id: "fast",
        label: "Orders never queue",
        metric: { node: "worker", field: "backlog" },
        op: "<",
        value: 5,
        when: "always",
      },
    ];
    const p = plan(d);
    const [s] = p.suggestions;
    expect(s).toMatchObject({ kind: "min", from: 1 });
    expect(s.startupBacklog).toBeGreaterThan(0);
    expect(s.verified!.startupBacklog).toBeLessThan(s.startupBacklog);
    expect(s.fix).toBeDefined();
  });
  it("reports unavailable when the planning budget is exceeded, before running anything", () => {
    const d = plannerFixture();
    for (let i = 0; i < 800; i++)
      d.nodes.push({ id: `filler-${i}`, stencil: "service.dotnet", label: `Filler ${i}`, x: 0, y: i * 10, props: {} });
    expect(planWork(d)).toBeGreaterThan(PLANNER_LIMITS.work);
    const counter = { ticks: 0, runs: 0 };
    const [p] = planScaling(d, counter);
    expect(p).toMatchObject({ status: "unavailable", reason: "budget", suggestions: [] });
    expect(counter).toEqual({ ticks: 0, runs: 0 });
  });
  it("bounds runs per simulation however many scalers it verifies (8× scalers, same runs and ticks)", () => {
    const counts = [1, 8].map((n) => {
      const d = plannerFixture();
      d.simulations![0].durationMs = 220_000;
      for (let i = 1; i < n; i++) {
        d.nodes.push({ ...structuredClone(d.nodes[1]), id: `worker-${i}`, y: 180 + i * 120 });
        d.edges.push({ ...d.edges[0], id: `requests-${i}`, to: `worker-${i}` });
      }
      const counter = { ticks: 0, runs: 0 };
      const [p] = planScaling(d, counter);
      return { runs: counter.runs, ticks: counter.ticks, suggestions: p.suggestions.length };
    });
    expect(counts[1].suggestions).toBe(8);
    expect(counts[1].runs).toBe(counts[0].runs);
    expect(counts[1].ticks).toBe(counts[0].ticks);
    expect(counts[1].runs).toBeLessThanOrEqual(PLANNER_LIMITS.runs);
  }, 60_000);
  it("is deterministic and memoized on the diagram's simulation-relevant content", () => {
    const d = plannerFixture();
    const a = planScaling(d),
      b = planScaling(structuredClone(d));
    expect(b).toBe(a);
    const counter = { ticks: 0, runs: 0 };
    planScaling(structuredClone(d), counter);
    expect(counter.runs).toBe(0);
  });
  it("skips a node whose simulation sets its own policy", () => {
    const d = plannerFixture();
    d.simulations![0].setup = { props: { worker: { autoscaling: { mode: "off" } } } };
    expect(plan(d)).toMatchObject({ status: "unavailable", reason: "policy" });
  });
});

describe("scenario sizing targets", () => {
  it("lowers a target the backlog-bound fleet never reached, and verifies it", () => {
    const d = cloudFixture("app-service");
    const a = d.nodes[1].props!.autoscaling as { controller: AppServiceController };
    Object.assign(a.controller, { evaluationMs: 5000, maxReplicas: 5 });
    Object.assign(a.controller.rules[0], { windowMs: 10_000, cooldownMs: 15_000 });
    Object.assign(a.controller.rules[1], { windowMs: 10_000, cooldownMs: 20_000 });
    d.simulations = [
      {
        id: "sale",
        title: "Flash sale",
        seed: 17,
        durationMs: 150_000,
        traffic: [{ id: "sale", node: "source", shape: { kind: "constant", ratePerSec: 40, durationMs: 60_000 } }],
      },
    ];
    const [s] = plan(d).suggestions;
    // Slot-bound at 64% CPU, a 70% scale-out rule never fires while the queue grows.
    expect(s).toMatchObject({ kind: "target", from: 70, to: 57, adapter: "appService", metricKind: "cpu" });
    const fixed = s.fix![0].props.autoscaling as { controller: AppServiceController };
    expect(fixed.controller.rules[0].threshold).toBe(57);
    expect(s.verified!.backlog).toBeLessThan(s.backlog);
  });
});
