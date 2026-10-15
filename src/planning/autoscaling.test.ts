import { createEngine } from "../sim/engine";
import { countingReads, LINEAR_LIMIT } from "../test/complexity";
import { describe, it, expect } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { autoscalingProblem } from "../model/autoscalingSchema";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { parseNative, serializeNative } from "../interop/native";
import { applyOps } from "../ai/ops";
import { makePayload, parsePayload, remapPayload } from "../editor/clipboard";
import { upgradeAutoscaling, legacyExport, upgradePlanning } from "./migration";
import { createSimulationRun } from "../sim/simulation";
import { analyzeCapacity } from "../sim/capacity";
import { sizingFix, sourceTraffic } from "../sim/capacityPlanning";
import { explainNode } from "./explanation";
import { runChecks } from "../checks/run";
import { freePlaySaveProps, emptyInputs } from "../live/capacityModel";
import { LiveController } from "../live/controller";
import type { AutoscalingConfig } from "../model/autoscaling";

describe("A1 configuration and common planning", () => {
  it("round-trips native/agent/clipboard settings and rejects unrecognised revisions", () => {
    const d = autoscalingFixture();
    const opened = parseNative(serializeNative(d));
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.diagram).toEqual(d);
    const a = hpaLesson();
    a.controller.maxReplicas = 14;
    const edited = applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: a } }], { layout: "none" });
    expect(edited.errors).toEqual([]);
    expect(edited.diagram.nodes[1].props!.autoscaling).toEqual(a);
    const copy = parsePayload(JSON.stringify(makePayload(d, ["worker"])));
    expect(copy?.planning).toEqual({ revision: "p3-a1" });
    expect(copy?.format).toBe("diagrams/clip-v2");
    expect(
      remapPayload(copy!, { nodes: new Set(["worker"]), edges: new Set(), groups: new Set() }, { x: 20, y: 20 })
        .nodes[0].props!.autoscaling,
    ).toEqual(d.nodes[1].props!.autoscaling);
    expect(parseNative(JSON.stringify({ ...d, planning: { revision: "future" } })).ok).toBe(false);
    expect(parseNative(JSON.stringify({ ...d, planning: { revision: "p3" } })).ok).toBe(false);
  });
  it("binds ContainerResource only to the one modelled container", () => {
    const a = hpaLesson(),
      r = resourceLesson();
    a.controller.settings.metrics[0].source.container = "worker";
    expect(autoscalingProblem(r, a)).toContain("single container");
    r.container = "worker";
    expect(autoscalingProblem(r, a)).toBeUndefined();
    const d = autoscalingFixture();
    d.nodes[1].props!.resources = r;
    d.nodes[1].props!.autoscaling = a;
    expect(parseNative(serializeNative(d)).ok).toBe(true);
  });
  it("rejects a document-wide lifecycle allocation bomb before execution", () => {
    const d = autoscalingFixture();
    d.nodes = Array.from({ length: 20 }, (_, i) => ({
      ...d.nodes[1],
      id: `worker${i}`,
      props: { ...d.nodes[1].props },
    }));
    d.edges = [];
    d.simulations = [
      {
        id: "budget",
        title: "Budget",
        durationMs: 1000,
        traffic: [],
        multipliers: { capacity: 100 },
        timeline: d.nodes.map((n) => ({
          atMs: 10,
          action: { do: "props" as const, node: n.id, props: { replicas: 10_000 } },
        })),
      },
    ];
    const opened = parseNative(serializeNative(d));
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error).toContain("lifecycle budget");
    expect(() => createEngine().load(d)).toThrow("lifecycle budget");
    const a = hpaLesson();
    a.controller.settings.metrics[0].metricDelayMs = 600_000;
    expect(
      applyOps(autoscalingFixture(), [{ op: "update", target: "worker", props: { autoscaling: a } }]).errors.length,
    ).toBeGreaterThan(0);
  });
  it("bounds hostile configs, validates ranges, and treats nested replacement as atomic", () => {
    const d = autoscalingFixture(),
      a = hpaLesson();
    a.controller.settings.metrics = Array.from({ length: 17 }, () => a.controller.settings.metrics[0]);
    expect(applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: a } }]).errors.length).toBeGreaterThan(
      0,
    );
    const reversed = hpaLesson();
    reversed.controller.minReplicas = 20;
    expect(
      applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: reversed } }]).errors.length,
    ).toBeGreaterThan(0);
    expect(
      applyOps(d, [{ op: "update", target: "worker", props: { resources: { cpuRequestMilli: 100 } } }]).errors.length,
    ).toBeGreaterThan(0);
    const off = applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: { mode: "off" } } }]);
    expect(off.diagram.nodes[1].props!.autoscaling).toEqual({ mode: "off" });
    const removed = applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: null } }]);
    expect(removed.diagram.nodes[1].props!.autoscaling).toBeUndefined();
  });
  it("plans the largest metric recommendation, including memory after CPU", () => {
    const d = autoscalingFixture(),
      a = hpaLesson(),
      r = resourceLesson();
    d.nodes[0].props!.ratePerSec = 100;
    r.baselineMemoryMiB = 128;
    r.memoryMiBPerMessage = 10;
    a.controller.settings.metrics.push({
      source: { kind: "resource", resource: "memory" },
      target: { kind: "averageValue", value: 140 },
      windowMs: 15_000,
      metricDelayMs: 0,
    });
    d.nodes[1].props!.resources = r;
    d.nodes[1].props!.autoscaling = a;
    const p = analyzeCapacity(d).nodes.worker.resourcePlan!;
    expect(p.targetReplicas).toBe(21);
    a.controller.settings.metrics[1].target = { kind: "averageValue", value: 100 };
    expect(analyzeCapacity(d).nodes.worker.resourcePlan!.baselineAboveTarget).toBe(true);
  });
  it("upgrades existing workloads without adding resources; legacy export lists model losses", () => {
    const d = autoscalingFixture();
    delete d.planning;
    d.format = "diagrams/v1";
    delete d.nodes[1].props!.resources;
    delete d.nodes[1].props!.autoscaling;
    const p3 = upgradePlanning(d),
      a1 = upgradeAutoscaling(p3);
    expect(a1.planning?.revision).toBe("p3-a1");
    expect(a1.nodes.map((n) => n.props)).toEqual(p3.nodes.map((n) => n.props));
    const legacy = legacyExport(autoscalingFixture());
    expect(legacy.losses).toContain("worker.props.resources");
    expect(legacy.losses).toContain("worker.props.autoscaling");
    expect(parseNative(serializeNative(legacy.diagram)).ok).toBe(true);
  });
  it("shares CPU arithmetic and memory/max findings; never fixes HPA by changing fixed replicas", () => {
    const d = autoscalingFixture();
    d.nodes[0].props!.ratePerSec = 115;
    const analysis = analyzeCapacity(d),
      x = explainNode(d, "worker", { analysis, fixes: false })!;
    expect(x.resources).toEqual(analysis.nodes.worker.resourcePlan);
    expect(x.resources!.targetReplicas).toBe(14);
    expect(runChecks(d).findings.find((f) => f.target === "worker")?.resourceFinding).toMatchObject({
      kind: "max",
      needed: 14,
      max: 10,
    });
    expect(sizingFix(d, { id: "load", title: "Load", traffic: sourceTraffic(d) }, [analysis.nodes.worker])).toBeNull();
    const r = resourceLesson();
    r.baselineMemoryMiB = 600;
    d.nodes[1].props!.resources = r;
    expect(runChecks(d).findings.find((f) => f.target === "worker")?.resourceFinding?.kind).toBe("memory");
  });
  it("shows constant baseline memory above target as unfixable by adding replicas", () => {
    const d = autoscalingFixture(),
      a = hpaLesson();
    a.controller.settings.metrics[0].source.resource = "memory";
    a.controller.settings.metrics[0].target = { kind: "utilization", percentOfRequest: 40 };
    d.nodes[1].props!.autoscaling = a;
    expect(explainNode(d, "worker", { fixes: false })!.resources!.baselineAboveTarget).toBe(true);
    expect(runChecks(d).findings.find((f) => f.target === "worker")?.resourceFinding?.kind).toBe("baseline");
  });
  it("scales initial/min/max once and pins the same range when saving Capacity ×", () => {
    const d = autoscalingFixture(),
      run = createSimulationRun(d, {
        id: "range",
        title: "Range",
        durationMs: 30_000,
        multipliers: { capacity: 2 },
        traffic: [],
      });
    expect(run.engine.frame().nodes.worker.fleet).toMatchObject({ ready: 2, desired: 2, starting: 0 });
    const patch = freePlaySaveProps(d, { ...emptyInputs(), capacity: 2 }).worker;
    const a = patch.autoscaling as AutoscalingConfig;
    expect(a.mode === "on" && a.controller).toMatchObject({ initialReplicas: 2, minReplicas: 2, maxReplicas: 20 });
    expect(patch.replicas).toBeUndefined();
  });
  it("timeline replicas explicitly suspend HPA until resume; checkpoint/restart reproduce it", () => {
    const d = autoscalingFixture();
    const run = createSimulationRun(d, {
      id: "override",
      title: "Override",
      seed: 3,
      durationMs: 60_000,
      traffic: sourceTraffic(d),
      timeline: [
        { atMs: 10_000, action: { do: "props", node: "worker", props: { replicas: 3 } } },
        { atMs: 30_000, action: { do: "props", node: "worker", props: { resumeAutoscaling: true } } },
      ],
    });
    run.step(20_000);
    expect(run.engine.frame().nodes.worker.fleet).toMatchObject({
      desired: 3,
      ready: 3,
      decision: { reason: "override", at: 10_000 },
    });
    const checkpoint = run.checkpoint();
    run.step(30_000);
    const full = run.units.realSnapshot();
    expect(full.nodes.worker.fleet!.decision!.at).toBe(45_000);
    expect(full.nodes.worker.fleet!.decision!.reason).not.toBe("override");
    run.restore(checkpoint);
    run.step(30_000);
    expect(run.units.realSnapshot()).toEqual(full);
    run.restart();
    run.step(50_000);
    expect(run.units.realSnapshot()).toEqual(full);
  });
  it("treats equal replica overrides and repeated resumes as commands", () => {
    const e = createEngine({ seed: 42 });
    e.load(autoscalingFixture());
    e.setTraffic(true);
    e.step(30_000);
    expect(e.frame().nodes.worker.fleet!.desired).toBeGreaterThan(1);
    for (let cycle = 0; cycle < 2; cycle++) {
      e.setNodeProps("worker", { replicas: 1 });
      e.step(5000);
      expect(e.frame().nodes.worker.fleet).toMatchObject({ desired: 1, ready: 1, decision: { reason: "override" } });
      e.setNodeProps("worker", { resumeAutoscaling: true });
      e.step(15_000);
      expect(e.frame().nodes.worker.fleet!.decision!.reason).not.toBe("override");
      expect(e.frame().nodes.worker.fleet!.desired).toBeGreaterThan(1);
      expect(e.effectiveProps("worker").resumeAutoscaling).toBeUndefined();
    }
  });
  it("saving a scaled HPA range keeps the controller as its owner", () => {
    const d = autoscalingFixture(),
      live = new LiveController(d),
      inputs = { ...emptyInputs(), capacity: 2 };
    live.setTraffic(true);
    live.setPlaying(true);
    live.setInputs(inputs);
    live.flush();
    const patches = freePlaySaveProps(d, inputs),
      saved = { ...d, nodes: d.nodes.map((n) => ({ ...n, props: { ...n.props, ...patches[n.id] } })) };
    live.commitInputs(null, saved);
    live.advance(15_000);
    expect(live.snapshot().nodes.worker.fleet!.decision!.reason).not.toBe("override");
    live.dispose();
  });
  it("compares unchanged resource settings with linear graph reads", () => {
    const reads = (n: number) => {
      const d = autoscalingFixture();
      d.edges = [];
      d.nodes = Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        label: "Node",
        stencil: "service.dotnet",
        x: i,
        y: 0,
      }));
      const live = new LiveController(d),
        counted = countingReads(d.nodes);
      d.nodes = counted.items;
      const before = counted.reads();
      live.updateDiagram({ ...d, nodes: d.nodes.map((node) => ({ ...node, x: node.x + 1 })) });
      const count = counted.reads() - before;
      live.dispose();
      return count;
    };
    expect(reads(1000) / reads(125)).toBeLessThan(LINEAR_LIMIT);
  });
  it("restarts live resource/policy edits rather than orphaning active work", () => {
    const d = autoscalingFixture(),
      live = new LiveController(d);
    live.setTraffic(true);
    live.setPlaying(true);
    live.advance(1000);
    const next = structuredClone(d);
    next.nodes[1].props!.resources = { ...resourceLesson(), cpuMsPerMessage: 200 };
    expect(live.updateDiagram(next)).toBe("reloaded");
    expect(live.snapshot().time).toBe(0);
    live.dispose();
  });
});
