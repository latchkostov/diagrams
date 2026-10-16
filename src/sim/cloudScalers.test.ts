import { describe, it, expect, vi } from "vitest";
import * as fleets from "./autoscaling";
import { Deque } from "./deque";
import { createSimulationRun } from "./simulation";
import { resolveNodeProps } from "./defaults";
import timetable from "../examples/cloud-run-timetable-api.json";
import type { DiagramFile } from "../model/types";
import { createFleet, type Fleet } from "./autoscaling";
import { evaluateCloud, percentChange, resetCloud, stepFor, type CloudReads } from "./cloudScalers";
import { createEngine } from "./engine";
import {
  cloudLesson,
  resourceLesson,
  type AcaController,
  type AppServiceController,
  type CloudController,
  type CloudRunController,
  type EcsController,
  type EcsStepScaling,
} from "../model/autoscaling";
import { checkAutoscaling, autoscalingProblem } from "../model/autoscalingSchema";
import { bindingValidator } from "../model/kedaBindings";
import { cloudFixture } from "../lab/cloudFixture";

const r = { ...resourceLesson(), cpuRequestMilli: 250, cpuLimitMilli: 1000 };
const quietReads = (routed = new Map<string, number>()): CloudReads => ({
  routed: (s) => routed.get(s),
  waiting: () => 0,
  inFlight: () => 0,
  broker: () => undefined,
});
/** One-second samples of `cpu` CPU-ms per replica-second across `ready` replicas, ending at `end`. */
function cpuSamples(f: Fleet, from: number, end: number, milliPerReplica: number) {
  for (let at = from + 1000; at <= end; at += 1000)
    f.samples.push({ at, cpu: milliPerReplica * f.ready, occupancy: 0, ready: f.ready });
}
function ecs(edit: (c: EcsController) => void = () => {}): EcsController {
  const c = structuredClone(cloudLesson("ecs-cpu").controller) as EcsController;
  edit(c);
  return c;
}
function run(f: Fleet, c: CloudController, at: number, reads = quietReads()) {
  f.nextSync = at;
  const d = evaluateCloud(f, c, r, at, reads, "worker", 1, 1, 4)!;
  // The engine reconciles the decision; these tests track desired directly.
  f.desired = d.desired;
  f.ready = d.desired;
  return d;
}

describe("ECS target tracking", () => {
  it("measures CPU against task CPU, not a Kubernetes request", () => {
    const c = ecs((c) => Object.assign(c, { metricPeriodMs: 60_000, alarm: { ...c.alarm, outPeriods: 1 } }));
    c.targetTracking[0].target = 50;
    const f = createFleet(1, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    cpuSamples(f, 0, 60_000, 600);
    const d = run(f, c, 60_000);
    // 600m of a 1000m task is 60% (240% of a 250m request would ask for five).
    expect(d).toMatchObject({ adapter: "ecs", metricKind: "cpu", target: 50, desired: 2, reason: "target" });
    expect(d.metric).toBeCloseTo(60);
  });
  it("counts ALB requests per running task per minute, waits for its alarm periods and records them", () => {
    const c = ecs((c) => {
      c.metricPeriodMs = 60_000;
      c.targetTracking = [
        { ...c.targetTracking[0], metric: "albRequestCountPerTarget", target: 1000, source: { node: "lb" } },
      ];
    });
    const routed = new Map([["lb", 0]]);
    const f = createFleet(2, 60_000);
    resetCloud(f, c, 0, "worker", quietReads(routed));
    const decisions = [1, 2, 3].map((minute) => {
      routed.set("lb", minute * 2400);
      return run(f, c, minute * 60_000, quietReads(routed));
    });
    expect(decisions[0]).toMatchObject({ reason: "alarm", periods: 1, periodsNeeded: 3, metric: 1200, desired: 2 });
    expect(decisions[1]).toMatchObject({ reason: "alarm", periods: 2, desired: 2 });
    expect(decisions[2]).toMatchObject({ reason: "target", metric: 1200, target: 1000, desired: 3 });
  });
  it("lets a larger scale-out through its cooldown without compounding, and blocks shrink in scale-in cooldown", () => {
    const c = ecs((c) => {
      c.metricPeriodMs = 60_000;
      c.alarm = { outPeriods: 1, inPeriods: 1, inMargin: 0.1 };
      c.targetTracking = [
        { ...c.targetTracking[0], metric: "albRequestCountPerTarget", target: 1000, source: { node: "lb" } },
      ];
    });
    const routed = new Map([["lb", 0]]);
    const f = createFleet(2, 60_000);
    resetCloud(f, c, 0, "worker", quietReads(routed));
    let total = 0,
      last = 0;
    // perTarget requests per running task per minute since the previous evaluation.
    const minute = (perTarget: number, at: number) => {
      total += (perTarget * f.ready * (at - last)) / 60_000;
      last = at;
      routed.set("lb", total);
      return run(f, c, at, quietReads(routed));
    };
    expect(minute(1200, 60_000)).toMatchObject({ desired: 3, reason: "target" });
    // Still in the 300 s scale-out cooldown at the same pressure: computed from its starting capacity, no growth.
    expect(minute(1200 * (2 / 3), 120_000)).toMatchObject({ desired: 3 });
    // A larger scale-out is admitted during the cooldown.
    expect(minute(2000, 180_000)).toMatchObject({ desired: 4, reason: "target" });
    // Load falls away: scale in once, then the scale-in cooldown blocks a second shrink.
    expect(minute(400, 600_000)).toMatchObject({ desired: 2, reason: "target" });
    expect(minute(100, 660_000)).toMatchObject({ desired: 2, reason: "cooldown" });
    // A scale-out during the scale-in cooldown happens immediately.
    expect(minute(5000, 720_000)).toMatchObject({ desired: 10, reason: "target" });
  });
  it("never scales in on missing data and cannot wake from zero on a per-task metric", () => {
    const c = ecs((c) =>
      Object.assign(c, {
        metricPeriodMs: 60_000,
        minReplicas: 0,
        alarm: { outPeriods: 1, inPeriods: 1, inMargin: 0.1 },
      }),
    );
    const f = createFleet(3, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    // No samples: insufficient data is not low load.
    expect(run(f, c, 60_000)).toMatchObject({ desired: 3, reason: "missing" });
    const zero = createFleet(0, 60_000);
    resetCloud(zero, c, 0, "worker", quietReads());
    expect(run(zero, c, 60_000)).toMatchObject({ desired: 0, reason: "missing" });
  });
  it("scale-in needs every target-tracking policy with scale-in enabled to agree", () => {
    const c = ecs((c) => {
      c.metricPeriodMs = 60_000;
      c.alarm = { outPeriods: 1, inPeriods: 1, inMargin: 0.1 };
      c.targetTracking = [
        { ...c.targetTracking[0], target: 50 },
        { ...c.targetTracking[0], metric: "albRequestCountPerTarget", target: 1000, source: { node: "lb" } },
      ];
    });
    const routed = new Map([["lb", 0]]);
    const f = createFleet(4, 60_000);
    resetCloud(f, c, 0, "worker", quietReads(routed));
    cpuSamples(f, 0, 60_000, 50); // 5% CPU wants one task
    routed.set("lb", 4 * 900); // 900 requests per task: inside the ALB target's 10% margin
    expect(run(f, c, 60_000, quietReads(routed))).toMatchObject({ desired: 4, reason: "tolerance" });
    c.targetTracking[1].disableScaleIn = true;
    f.decision = undefined;
    cpuSamples(f, 60_000, 120_000, 50);
    routed.set("lb", 4 * 900 * 2);
    expect(run(f, c, 120_000, quietReads(routed))).toMatchObject({ desired: 1, reason: "target", policy: 0 });
  });
});

describe("ECS step scaling", () => {
  const out: EcsStepScaling = {
    metric: "cpu",
    operator: "GreaterThanOrEqualToThreshold",
    threshold: 50,
    evaluationPeriods: 1,
    adjustmentType: "PercentChangeInCapacity",
    steps: [
      { lower: 0, upper: 10, adjustment: 0 },
      { lower: 10, upper: 20, adjustment: 10 },
      { lower: 20, adjustment: 30 },
    ],
    cooldownMs: 0,
  };
  const scaleIn: EcsStepScaling = {
    ...out,
    operator: "LessThanThreshold",
    steps: [
      { lower: -10, upper: 0, adjustment: 0 },
      { lower: -20, upper: -10, adjustment: -10 },
      { upper: -20, adjustment: -30 },
    ],
  };
  it("rounds percent changes and applies the minimum magnitude as documented", () => {
    expect([1270, 67, -58, -667].map((p) => percentChange(100, p / 100))).toEqual([12, 1, -1, -6]);
    expect(percentChange(4, 25, 2)).toBe(2);
    expect(percentChange(10, 0)).toBe(0);
  });
  it("uses inclusive/exclusive bounds on each side of the threshold", () => {
    expect(stepFor(out, 60)?.adjustment).toBe(10);
    expect(stepFor(out, 59.9)?.adjustment).toBe(0);
    expect(stepFor(scaleIn, 40)?.adjustment).toBe(-10);
    expect(stepFor(scaleIn, 30.1)?.adjustment).toBe(-10);
    expect(stepFor(scaleIn, 30)?.adjustment).toBe(-30);
  });
  it("reproduces AWS's documented 10 → 11 → 14 → 13 → 10 example", () => {
    const c = ecs((c) => {
      c.metricPeriodMs = 60_000;
      c.maxReplicas = 100;
      c.targetTracking = [];
      c.stepScaling = [out, scaleIn];
    });
    checkAutoscaling(r, { ...cloudLesson("ecs-step"), controller: c });
    const f = createFleet(10, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    const desired = [60, 70, 40, 30].map((pct, i) => {
      const at = (i + 1) * 60_000;
      cpuSamples(f, at - 60_000, at, pct * 10);
      return run(f, c, at).desired;
    });
    expect(desired).toEqual([11, 14, 13, 10]);
  });
  it("counts a scale-out's capacity inside its cooldown and blocks scale-in during the scale-in cooldown", () => {
    const c = ecs((c) => {
      c.metricPeriodMs = 60_000;
      c.maxReplicas = 100;
      c.targetTracking = [];
      c.stepScaling = [
        {
          ...out,
          adjustmentType: "ChangeInCapacity",
          steps: [
            { lower: 0, upper: 20, adjustment: 2 },
            { lower: 20, adjustment: 3 },
          ],
          cooldownMs: 300_000,
        },
        { ...scaleIn, adjustmentType: "ChangeInCapacity", steps: [{ upper: 0, adjustment: -1 }], cooldownMs: 300_000 },
      ];
    });
    const f = createFleet(4, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    const at = (minute: number, pct: number) => {
      cpuSamples(f, (minute - 1) * 60_000, minute * 60_000, pct * 10);
      return run(f, c, minute * 60_000);
    };
    expect(at(1, 60).desired).toBe(6);
    // Same breach inside the cooldown: the earlier +2 counts, so nothing more.
    expect(at(2, 60).desired).toBe(6);
    // A more aggressive step adds only the difference (+3 over the original 4).
    expect(at(3, 75).desired).toBe(7);
    expect(at(10, 10).desired).toBe(6);
    expect(at(11, 10)).toMatchObject({ desired: 6, reason: "cooldown" });
  });
  it("wakes from zero on the load balancer's total request count", () => {
    const c = ecs((c) => {
      c.metricPeriodMs = 60_000;
      c.minReplicas = 0;
      c.initialReplicas = 0;
      c.targetTracking = [];
      c.stepScaling = [
        {
          metric: "albRequestCount",
          source: { node: "lb" },
          operator: "GreaterThanThreshold",
          threshold: 0,
          evaluationPeriods: 1,
          adjustmentType: "ExactCapacity",
          steps: [{ lower: 0, adjustment: 1 }],
          cooldownMs: 0,
        },
      ];
    });
    const routed = new Map([["lb", 0]]);
    const f = createFleet(0, 60_000);
    resetCloud(f, c, 0, "worker", quietReads(routed));
    expect(run(f, c, 60_000, quietReads(routed)).desired).toBe(0);
    routed.set("lb", 5);
    expect(run(f, c, 120_000, quietReads(routed))).toMatchObject({ desired: 1, reason: "step", metric: 5 });
  });
  it("rejects overlapping or gapped steps and steps that don't cover the breached side", () => {
    const base = cloudLesson("ecs-step");
    const bad = (steps: EcsStepScaling["steps"]) => {
      const a = structuredClone(base);
      (a.controller as EcsController).stepScaling[0].steps = steps;
      return () => checkAutoscaling(r, a);
    };
    expect(
      bad([
        { lower: 0, upper: 10, adjustment: 1 },
        { lower: 5, adjustment: 2 },
      ]),
    ).toThrow(/overlap|gap/);
    expect(
      bad([
        { lower: 0, upper: 10, adjustment: 1 },
        { lower: 12, adjustment: 2 },
      ]),
    ).toThrow(/overlap|gap/);
    expect(bad([{ lower: 5, adjustment: 1 }])).toThrow(/breached side/);
    expect(bad([{ adjustment: 1 }])).toThrow(/bound/);
  });
});

describe("ECS bindings and units", () => {
  it("binds ALB metrics only to a load balancer routing requests to the service, never async throughput", () => {
    const d = cloudFixture("ecs-alb");
    const valid = bindingValidator(d.nodes, d.edges);
    const a = d.nodes.find((n) => n.id === "worker")!.props!.autoscaling as Parameters<typeof valid>[0];
    expect(valid(a, "worker")).toBe(true);
    expect(valid(a, "source")).toBe(false);
    const asyncEdges = d.edges.map((e) => (e.id === "requests" ? { ...e, kind: "async" as const } : e));
    expect(bindingValidator(d.nodes, asyncEdges)(a, "worker")).toBe(false);
    const wrong = d.nodes.map((n) => (n.id === "lb" ? { ...n, stencil: "aws.sqs" } : n));
    expect(bindingValidator(wrong, d.edges)(a, "worker")).toBe(false);
    expect(() =>
      checkAutoscaling(r, {
        ...cloudLesson("ecs-cpu"),
        controller: {
          ...cloudLesson("ecs-cpu").controller,
          targetTracking: [
            { ...(cloudLesson("ecs-cpu").controller as EcsController).targetTracking[0], source: { node: "lb" } },
          ],
        },
      }),
    ).toThrow(/ALB/);
  });
  it("needs the task's CPU size for CPU utilisation", () => {
    expect(autoscalingProblem({ ...r, cpuLimitMilli: undefined }, cloudLesson("ecs-cpu"))).toMatch(/task/);
    expect(autoscalingProblem(r, cloudLesson("ecs-cpu"))).toBeUndefined();
  });
});

describe("Azure Monitor autoscale (App Service)", () => {
  const appService = (edit: (c: AppServiceController) => void = () => {}) => {
    const c = structuredClone(cloudLesson("app-service").controller) as AppServiceController;
    c.evaluationMs = 60_000;
    for (const rule of c.rules) Object.assign(rule, { windowMs: 60_000, cooldownMs: 0 });
    edit(c);
    return c;
  };
  it("defers a scale-in that would flap, as the documented 56% example does", () => {
    const c = appService((c) => {
      c.rules[0].threshold = 50;
      c.rules[1].threshold = 30;
    });
    const f = createFleet(1, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    cpuSamples(f, 0, 60_000, 560);
    expect(run(f, c, 60_000)).toMatchObject({ desired: 2, reason: "rule", policy: 0 });
    cpuSamples(f, 60_000, 120_000, 280);
    expect(run(f, c, 120_000)).toMatchObject({ desired: 2, reason: "flapping" });
    cpuSamples(f, 120_000, 180_000, 200);
    expect(run(f, c, 180_000)).toMatchObject({ desired: 1, reason: "rule", policy: 1 });
  });
  it("scales out on any rule (highest capacity) and in only when every scale-in rule agrees", () => {
    const c = appService((c) => {
      c.maxReplicas = 20;
      c.rules = [
        c.rules[0],
        { ...c.rules[0], changeType: "PercentChangeCount", value: 50 },
        c.rules[1],
        { ...c.rules[1], metric: "memory", threshold: 10 },
      ];
    });
    const f = createFleet(4, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    cpuSamples(f, 0, 60_000, 800);
    expect(run(f, c, 60_000)).toMatchObject({ desired: 6, policy: 1 });
    // CPU is low, but memory (128 MiB baseline of 512) is not under 10%: no scale-in.
    cpuSamples(f, 60_000, 120_000, 10);
    expect(run(f, c, 120_000)).toMatchObject({ desired: 6, reason: "tolerance" });
  });
  it("applies each rule's own cooldown from the most recent scale action, on simulation time", () => {
    const c = appService((c) => {
      c.rules[0].cooldownMs = 300_000;
      c.rules[1].cooldownMs = 120_000;
    });
    const f = createFleet(2, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    cpuSamples(f, 0, 60_000, 900);
    expect(run(f, c, 60_000).desired).toBe(3);
    cpuSamples(f, 60_000, 120_000, 900);
    expect(run(f, c, 120_000).desired).toBe(3);
    cpuSamples(f, 120_000, 180_000, 50);
    expect(run(f, c, 180_000)).toMatchObject({ desired: 2, reason: "rule" });
  });
  it("restores the default capacity when a metric can't be read, and never scales in on it", () => {
    const c = appService((c) => {
      c.initialReplicas = 3;
    });
    const f = createFleet(2, 60_000);
    resetCloud(f, c, 0, "worker", quietReads());
    expect(run(f, c, 60_000)).toMatchObject({ desired: 3, reason: "default" });
    expect(run(f, c, 120_000)).toMatchObject({ desired: 3, reason: "missing" });
  });
});

describe("Cloud Run", () => {
  const cloudRun = (edit: (c: CloudRunController) => void = () => {}) => {
    const c = structuredClone(cloudLesson("cloud-run").controller) as CloudRunController;
    edit(c);
    return c;
  };
  it("measures CPU against the instance's CPU limit with a 10% relative tolerance", () => {
    const c = cloudRun((c) => (c.concurrencyWindowsMs = [60_000, 60_000]));
    const f = createFleet(2, 10_000);
    resetCloud(f, c, 0, "worker", quietReads());
    cpuSamples(f, 0, 60_000, 650); // 65% of 1000m: inside 54–66%
    expect(run(f, c, 60_000)).toMatchObject({ desired: 2, reason: "tolerance" });
    cpuSamples(f, 60_000, 120_000, 900);
    const d = run(f, c, 120_000);
    // 90% of the limit against a 60% target: ceil(2 × 1.5).
    expect(d).toMatchObject({ adapter: "cloudRun", metricKind: "cpu", target: 60, desired: 3 });
  });
});

describe("cloud adapters in the engine", () => {
  it("Cloud Run starts instances on demand for waiting requests at its pinned concurrency, then scales to zero", () => {
    const d = cloudFixture("cloud-run");
    const a = d.nodes[1].props!.autoscaling as { controller: CloudRunController };
    Object.assign(a.controller, {
      evaluationMs: 1000,
      cpuWindowMs: 1000,
      concurrencyWindowsMs: [1000, 2000],
      scaleInDelayMs: 2000,
    });
    (d.nodes[1].props!.resources as { startup: { delayMs: number } }).startup.delayMs = 1000;
    const e = createEngine();
    e.load(d);
    expect(e.frame().nodes.worker.fleet).toMatchObject({ desired: 0, ready: 0 });
    e.inject("source", 200);
    e.step(30);
    // 200 waiting requests at 80 concurrent requests per instance: three instances, nothing processed before ready.
    expect(e.frame().nodes.worker.fleet).toMatchObject({ desired: 3, starting: 3, decision: { reason: "request" } });
    expect(e.frame().nodes.worker.processed).toBe(0);
    e.step(2000);
    expect(e.frame().nodes.worker.fleet!.ready).toBeGreaterThan(0);
    e.step(20_000);
    expect(e.frame().nodes.worker).toMatchObject({ processed: 200, fleet: { desired: 0, ready: 0 } });
  });
  it("Container Apps HTTP wakes on a request, scales 1 → 4 → 8 on its 15 s sync, and keeps the 300 s final-zero cooldown", () => {
    const d = cloudFixture("aca-http");
    d.nodes[0].props!.ratePerSec = 200;
    (d.nodes[1].props!.resources as { startup: { delayMs: number } }).startup.delayMs = 0;
    Object.assign(d.nodes[1].props!, { latencyMs: 10, concurrency: 1000 });
    (d.nodes[1].props!.autoscaling as { controller: { maxReplicas: number } }).controller.maxReplicas = 30;
    const e = createEngine();
    e.load(d);
    e.setTraffic(true);
    e.step(100);
    expect(e.frame().nodes.worker.fleet).toMatchObject({ desired: 1, decision: { reason: "request", adapter: "aca" } });
    const desired: number[] = [];
    for (let t = 1; t <= 4; t++) {
      e.step(15_000);
      desired.push(e.frame().nodes.worker.fleet!.desired);
    }
    // 200 req/s over a target of 10 asks for 20: documented steps 1, 4, 8, 16, then the target.
    expect(desired).toEqual([4, 8, 16, 20]);
    const http = e.frame().nodes.worker.fleet!.decision!;
    expect(http).toMatchObject({ metricKind: "httpRate", target: 10 });
    expect(http.metric).toBeCloseTo(200, 0);
    e.setNodeProps("source", { ratePerSec: 0 });
    e.step(240_000);
    expect(e.frame().nodes.worker.fleet!.desired).toBeGreaterThan(0);
    e.step(120_000);
    expect(e.frame().nodes.worker.fleet!.desired).toBe(0);
  });
  it("Container Apps event rules wake only on their own poll", () => {
    const d = cloudFixture("aca-event");
    const a = d.nodes[1].props!.autoscaling as { controller: { pollingMs: number } };
    a.controller.pollingMs = 5000;
    const e = createEngine();
    e.load(d);
    e.inject("queue", 3);
    e.step(4990);
    expect(e.frame().nodes.worker.fleet!.desired).toBe(0);
    e.step(10);
    expect(e.frame().nodes.worker.fleet).toMatchObject({
      desired: 1,
      decision: { reason: "activation", adapter: "aca" },
    });
  });
});

describe("request metrics count only pushed requests, over their documented windows", () => {
  it("Container Apps HTTP averages the past 15 s of arrivals per second", () => {
    const c = structuredClone(cloudLesson("aca-http").controller) as AcaController;
    Object.assign(c, { minReplicas: 1, initialReplicas: 1, maxReplicas: 50 });
    c.settings.syncMs = 15_000;
    const f = createFleet(1, 15_000);
    resetCloud(f, c, 0, "worker", quietReads());
    // 300 requests in one second, then nothing: 20 requests/s over the documented 15 s window.
    for (let at = 1000; at <= 15_000; at += 1000)
      f.samples.push({ at, cpu: 0, occupancy: 0, ready: 1, inFlight: 0, waiting: 0, arrivals: at === 2000 ? 300 : 0 });
    f.nextSync = 15_000;
    const d = evaluateCloud(f, c, r, 15_000, quietReads(), "worker", 1, 1, 4)!;
    expect(d).toMatchObject({ metricKind: "httpRate", metric: 20, target: 10, windowMs: 15_000 });
  });
  it("an App Service HTTP queue rule ignores broker deliveries waiting at the instance", () => {
    const d = cloudFixture("app-service");
    Object.assign(d.nodes[0], { id: "queue", stencil: "azure.service-bus.queue", label: "Jobs", props: {} });
    d.edges = [{ id: "consume", from: "queue", to: "worker", kind: "async", props: { travelMs: 10 } }];
    const a = d.nodes[1].props!.autoscaling as { controller: AppServiceController };
    Object.assign(a.controller, { evaluationMs: 1000, maxReplicas: 5 });
    a.controller.rules = [
      { ...a.controller.rules[0], metric: "httpQueue", threshold: 0.5, windowMs: 1000, cooldownMs: 0 },
      {
        ...a.controller.rules[1],
        metric: "httpQueue",
        threshold: 0,
        operator: "LessThan",
        windowMs: 1000,
        cooldownMs: 0,
      },
    ];
    const e = createEngine();
    e.load(d);
    e.inject("queue", 400);
    e.step(10_000);
    // Prefetched deliveries queue at the instance, but none of them is an HTTP request.
    expect(e.frame().nodes.worker.backlog).toBeGreaterThan(0);
    expect(e.frame().nodes.worker.fleet).toMatchObject({ desired: 1 });
  });
});

describe("bounded per-tick adapter work", () => {
  it.each(["ecs-cpu", "aca-http", "app-service", "cloud-run"] as const)(
    "%s: 8× more idle instances cost no more fleet visits per tick",
    (preset) => {
      const original = fleets.createFleet;
      const run = (n: number) => {
        let visits = 0;
        const spy = vi.spyOn(fleets, "createFleet").mockImplementation((...args) => {
          const f = original(...args);
          for (let i = 0; i < n; i++) fleets.acquireReplica(f, 1);
          for (const id of f.busy.keys()) fleets.releaseReplica(f, id, 1);
          const wrap = <T>(items: MapIterator<T>): MapIterator<T> => {
            const next = items.next.bind(items);
            items.next = () => {
              const item = next();
              if (!item.done) visits++;
              return item;
            };
            return items;
          };
          const values = f.busy.values.bind(f.busy),
            entries = f.busy.entries.bind(f.busy);
          f.busy.values = () => wrap(values());
          f.busy[Symbol.iterator] = () => wrap(entries());
          for (const key of ["ranges", "starts", "free", "busyIds", "samples"] as const)
            Reflect.set(
              f,
              key,
              new Proxy(f[key], {
                get(target, key, receiver) {
                  if (typeof key === "string" && /^\d+$/.test(key)) visits++;
                  return Reflect.get(target, key, receiver) as unknown;
                },
              }),
            );
          return new Proxy(f, {
            get(target, key, receiver) {
              visits++;
              return Reflect.get(target, key, receiver) as unknown;
            },
          });
        });
        try {
          const d = cloudFixture(preset);
          const a = d.nodes[1].props!.autoscaling as { controller: CloudController };
          Object.assign(a.controller, { minReplicas: n, initialReplicas: n, maxReplicas: n });
          if (a.controller.kind === "ecs") a.controller.metricPeriodMs = 1000;
          if (a.controller.kind === "appService" || a.controller.kind === "cloudRun") a.controller.evaluationMs = 1000;
          if (a.controller.kind === "aca") Object.assign(a.controller, { pollingMs: 1000 });
          const e = createEngine();
          e.load(d);
          visits = 0;
          for (let i = 0; i < 300; i++) {
            e.step(10);
            e.frame();
          }
          return visits;
        } finally {
          spy.mockRestore();
        }
      };
      const small = run(1250),
        large = run(10_000);
      expect(small).toBeGreaterThan(0);
      expect(large).toBe(small);
    },
  );
  it("request scalers read waiting requests without traversing the queue (8× queued requests)", () => {
    for (const preset of ["cloud-run", "aca-http", "app-service"] as const)
      for (const count of [1000, 8000]) {
        const d = cloudFixture(preset);
        const a = d.nodes[1].props!.autoscaling as { controller: CloudController };
        Object.assign(a.controller, { minReplicas: 1, initialReplicas: 1, maxReplicas: 1 });
        const e = createEngine();
        e.load(d);
        e.inject("source", count);
        e.step(100);
        const reads = vi.spyOn(Deque.prototype, Symbol.iterator);
        try {
          e.step(2000);
          expect(reads, `${preset} ${count}`).not.toHaveBeenCalled();
        } finally {
          reads.mockRestore();
        }
      }
  });
});

describe("A3 playback determinism", () => {
  const showcase = () => structuredClone(timetable as DiagramFile);
  it("replays the same decisions after a checkpoint restore", () => {
    for (const preset of ["ecs-alb", "aca-http", "app-service", "cloud-run"] as const) {
      const d = cloudFixture(preset);
      d.nodes[0].props = { ratePerSec: 60 };
      const sim = { id: "s", title: "S", seed: 3, durationMs: 120_000, traffic: [] };
      const run = createSimulationRun(d, sim);
      run.engine.setTraffic(true);
      run.step(20_000);
      const cp = run.checkpoint();
      const trace = () => {
        const out: unknown[] = [];
        for (let i = 0; i < 20; i++) {
          run.step(1000);
          out.push(run.engine.fleet("worker"));
        }
        return out;
      };
      const first = trace();
      run.restore(cp);
      expect(trace(), preset).toEqual(first);
    }
  });
  it("sampled traffic (scale 10) tracks the exact run's fleet", () => {
    const peaks = [1, 10].map((scale) => {
      const d = showcase();
      const sim = { ...d.simulations![0], scale };
      const run = createSimulationRun(d, sim);
      let peak = 0;
      while (!run.state().done) {
        if (run.state().waiting) run.resume();
        run.step(1000);
        peak = Math.max(peak, run.engine.fleet("worker")!.desired);
      }
      return { peak, end: run.engine.fleet("worker")!.desired };
    });
    expect(peaks[1].peak).toBe(peaks[0].peak);
    expect(peaks.map((p) => p.end)).toEqual([0, 0]);
  });
});

describe("the P3 boundary", () => {
  it("never attaches a cloud policy to a native serverless node", () => {
    const d = cloudFixture("cloud-run");
    d.nodes[1].stencil = "aws.lambda";
    const p = resolveNodeProps(d, d.nodes[1]);
    expect(p.autoscaling).toBeUndefined();
    expect(p.autoscalingProblem).toMatch(/managed allocation/);
  });
});
