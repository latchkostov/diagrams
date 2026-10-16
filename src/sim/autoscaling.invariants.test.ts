import { readFileSync } from "node:fs";
import * as allocations from "../sim/allocation";
import { LifecycleBudgetError } from "../model/resourceBudget";
import { createSimulationRun } from "./simulation";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { NodeSimProps, NodeStatus } from "./types";
import {
  cloudLesson,
  hpaLesson,
  kedaLesson,
  resourceLesson,
  type CloudConfig,
  type CloudPreset,
} from "../model/autoscaling";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { createEngine } from "./engine";
import { mulberry32 } from "./rng";
import { assertResourceInvariants } from "./resourceInvariants";
import { analyzeCapacity } from "./capacity";
import { resolveNodeProps } from "./defaults";

type Action = { ms: number } & (
  | { do: "refuse" }
  | { do: "burst"; count: number }
  | { do: "status"; status: NodeStatus }
  | { do: "props"; props: NodeSimProps; unset?: string[] }
);
function generate(seed: number) {
  const random = mulberry32(seed),
    pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
  const d = autoscalingFixture();
  const keda = seed % 3 === 0;
  const broker = keda || pick([true, false]);
  if (broker) {
    d.nodes[0].stencil = pick(["kafka.topic", "aws.sqs"]);
    d.nodes[0].props = { partitions: pick([1, 2, 4]), maxDeliveryCount: 4 };
    d.edges[0].kind = "async";
  }
  const resources = {
    ...resourceLesson(),
    cpuMsPerMessage: pick([0, 10, 100, 1000]),
    cpuLimitMilli: pick([50, 1000]),
    baselineMemoryMiB: pick([0, 100]),
    memoryMiBPerMessage: pick([1, 10, 100]),
    startup: { delayMs: pick([0, 30, 200]), jitterFraction: pick([0, 0.5]) },
    terminationGraceMs: pick([0, 50, 300]),
  };
  const hpa = () => {
    const a = hpaLesson();
    Object.assign(a.controller, { minReplicas: pick([1, 2]), initialReplicas: 2, maxReplicas: pick([3, 5]) });
    a.controller.settings.syncMs = 1000;
    a.controller.settings.metrics[0].windowMs = 1000;
    a.controller.settings.metrics[0].metricDelayMs = pick([0, 1000]);
    a.controller.settings.down = {
      stabilizationMs: 0,
      selectPolicy: "Max",
      policies: [{ type: "Percent", value: pick([10, 25, 100]), periodMs: 1000 }],
    };
    return a;
  };
  const scaler = () => {
    if (!keda) return hpa();
    const a = kedaLesson(d.nodes[0].stencil === "aws.sqs" ? "aws-sqs-queue" : "kafka", {
      node: "source",
      ...(d.nodes[0].stencil === "aws.sqs" ? {} : { group: "requests" }),
    });
    Object.assign(a.controller, {
      pollingMs: 1000,
      cooldownMs: pick([0, 1000, 3000]),
      initialCooldownMs: pick([0, 1000]),
      maxReplicas: 5,
    });
    a.controller.triggers[0].activation = pick([0, 1, 5]);
    a.controller.settings.syncMs = 1000;
    return a;
  };
  const admission = () => ({
    quotas: [
      {
        id: "requests",
        unit: "requests" as const,
        amount: pick([1, 5, 20]),
        windowMs: 1000,
        burst: 1,
        algorithm: "token-bucket" as const,
      },
    ],
  });
  d.nodes[1].props = {
    ...d.nodes[1].props,
    replicas: pick([1, 2, 4]),
    concurrency: pick([1, 2]),
    latencyMs: pick([10, 100, 500]),
    resources,
    autoscaling: pick([scaler(), { mode: "off" as const }]),
    failureRate: pick([0, 0.5, 1]),
    retry: "inplace",
    retryBackoffMs: pick([0, 100, 300, 5000]),
    ...(pick([true, false]) ? { api: admission() } : {}),
  };
  // Small fan-outs exercise the run-wide budget and independent fleets too.
  for (let i = 0, n = pick([0, 1, 2]); i < n; i++) {
    const node = { ...structuredClone(d.nodes[1]), id: `extra-${i}` };
    d.nodes.push(node);
    d.edges.push({ ...d.edges[0], id: `extra-edge-${i}`, to: node.id });
  }
  // Saturate at the old concurrency before lowering it; subsequent bursts try replacements.
  const actions: Action[] = [
    { do: "props", props: { concurrency: 4 }, ms: 10 },
    { do: "burst", count: 20, ms: 30 },
    { do: "props", props: { concurrency: 1 }, ms: 100 },
    { do: "burst", count: 8, ms: 100 },
  ];
  for (let i = 0; i < 70; i++) {
    const ms = pick(keda ? [10, 100, 1000, 3000] : [10, 30, 100, 300]);
    switch (pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      case 9:
        actions.push({ do: "refuse", ms });
        break;
      case 0:
      case 1:
        actions.push({ do: "burst", count: pick([1, 3, 8, 20]), ms });
        break;
      case 2:
        actions.push({ do: "status", status: pick(["up", "paused", "down"]), ms });
        break;
      case 3:
        actions.push({
          do: "props",
          props: { resources: pick([resources, undefined]), replicas: pick([1, 2, 4]) },
          ms,
        });
        break;
      case 4:
        actions.push({ do: "props", props: { autoscaling: scaler() }, ms });
        break;
      case 5:
        actions.push({ do: "props", props: { api: pick([admission(), undefined]) }, ms });
        break;
      case 6:
        actions.push({ do: "props", props: { autoscaling: { mode: "off" }, replicas: pick([1, 2, 3, 5]) }, ms });
        break;
      case 7:
        actions.push({ do: "props", props: { concurrency: pick([1, 2, 4]) }, ms });
        break;
      default:
        actions.push({
          do: "props",
          props: { failureRate: pick([0, 1]), retryBackoffMs: pick([0, 100, 300, 5000]) },
          ms,
        });
    }
  }
  return {
    d,
    scale: pick([1, 1, 2, 10]),
    actions: actions.map((action) =>
      action.do !== "props"
        ? action
        : {
            ...action,
            unset: Object.keys(action.props).filter((key) => action.props[key as keyof NodeSimProps] === undefined),
            props: Object.fromEntries(Object.entries(action.props).filter(([, value]) => value !== undefined)),
          },
    ),
  };
}
function replay(d: DiagramFile, seed: number, scale: number, actions: Action[]) {
  try {
    const e = createEngine({ seed, scale, verifyResources: assertResourceInvariants });
    let at = 0;
    const timeline = actions.flatMap((a) => {
      const time = at + 10;
      at += a.ms;
      return a.do === "refuse"
        ? [{ atMs: time, action: { do: "props" as const, node: "worker", props: { replicas: 2 } } }]
        : [];
    });
    const run = createSimulationRun(
      d,
      { id: "fuzz", title: "Fuzz", seed, scale, durationMs: at + 1000, traffic: [], timeline },
      { engine: e },
    );
    const checkCapacity = () => {
      const configuration = e.configuration();
      const current = { ...d, nodes: d.nodes.map((n) => ({ ...n, props: configuration[n.id] })) };
      const analysis = analyzeCapacity(current);
      for (const node of current.nodes) {
        const r = resolveNodeProps(current, node).resources;
        const milli = r?.cpuLimitMilli ?? r?.availableCpuMilli;
        if (
          r?.cpuMsPerMessage &&
          milli !== undefined &&
          analysis.nodes[node.id].capacity > (analysis.nodes[node.id].activeReplicas * milli) / r.cpuMsPerMessage + 1e-8
        )
          throw new Error(`${node.id}: capacity ignores CPU execution limit`);
      }
    };
    checkCapacity();
    for (const action of actions) {
      if (action.do === "burst") e.inject("source", action.count);
      else if (action.do === "status") e.setNodeStatus("worker", action.status);
      else if (action.do === "props")
        e.setNodeProps("worker", {
          ...action.props,
          ...Object.fromEntries((action.unset ?? []).map((key) => [key, undefined])),
        });
      if (action.do === "refuse") {
        const cp = run.checkpoint(),
          before = e.snapshot(),
          state = run.state();
        const budget = vi.spyOn(allocations, "validateAllocationActions").mockImplementationOnce(() => {
          throw new LifecycleBudgetError("Budget");
        });
        try {
          expect(() => run.step(action.ms)).toThrow(LifecycleBudgetError);
        } finally {
          budget.mockRestore();
        }
        expect(run.state(), "refusal changes runner state").toEqual(state);
        expect(e.snapshot(), "refusal changes engine state").toEqual(before);
        run.step(action.ms);
        const next = { state: run.state(), snapshot: e.snapshot() };
        run.restore(cp);
        run.step(action.ms);
        expect({ state: run.state(), snapshot: e.snapshot() }, "refusal changes next step").toEqual(next);
      } else run.step(action.ms); // The diagnostic runs after EVERY internal 10 ms step.
      checkCapacity();
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** Delete chunks, then individual events: the printed reproduction is 1-minimal for this invariant. */
function minimize(d: DiagramFile, seed: number, scale: number, actions: Action[], failure: string) {
  const signature = (s: string | undefined) => s?.replace(/@\d+/, "@");
  let result = actions;
  for (let size = Math.max(1, Math.floor(result.length / 2)); size >= 1; size = Math.floor(size / 2)) {
    for (let i = 0; i < result.length;) {
      const candidate = result.slice(0, i).concat(result.slice(i + size));
      if (signature(replay(d, seed, scale, candidate)) === signature(failure)) {
        result = candidate;
        i = 0;
      } else i++;
    }
  }
  let diagram = d;
  for (const node of d.nodes.filter((n) => n.id !== "source" && n.id !== "worker")) {
    const candidate = {
      ...diagram,
      nodes: diagram.nodes.filter((n) => n.id !== node.id),
      edges: diagram.edges.filter((e) => e.from !== node.id && e.to !== node.id),
    };
    if (signature(replay(candidate, seed, scale, result)) === signature(failure)) diagram = candidate;
  }
  if (diagram !== d) return minimize(diagram, seed, scale, result, failure);
  return { diagram, events: result };
}
describe("A1 seeded ownership invariants", () => {
  const cases = process.env.A1_FUZZ_NIGHTLY ? 5000 : 200;
  const seeds = process.env.A1_FUZZ_SEED
    ? [Number(process.env.A1_FUZZ_SEED)]
    : [...new Set([...Array.from({ length: cases }, (_, i) => i + 1), 505, 1724])];
  it.each(seeds)("seed %i", (seed) => {
    const { d, scale, actions } = generate(seed);
    const failure = replay(d, seed, scale, actions);
    if (failure)
      throw new Error(
        `Seed ${seed}, scale ${scale}: ${failure}\nMinimal reproduction: ${JSON.stringify(minimize(d, seed, scale, actions, failure))}`,
      );
    expect(failure).toBeUndefined();
  });
});

const CLOUD_PRESETS: CloudPreset[] = [
  "ecs-cpu",
  "ecs-alb",
  "ecs-step",
  "aca-http",
  "aca-event",
  "app-service",
  "cloud-run",
];
/** A3: every cloud adapter on the same lifecycle, with shortened clocks so cooldowns, alarms and zero all happen. */
function generateCloud(seed: number) {
  const random = mulberry32(seed ^ 0x5a3c10d),
    pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
  const preset = CLOUD_PRESETS[seed % CLOUD_PRESETS.length];
  const d = autoscalingFixture();
  const worker = d.nodes[1];
  worker.stencil =
    preset === "cloud-run"
      ? "gcp.cloud-run"
      : preset === "app-service"
        ? "azure.app-service"
        : preset.startsWith("aca")
          ? "azure.container-apps"
          : "aws.ecs";
  if (preset === "aca-event") {
    Object.assign(d.nodes[0], { stencil: "azure.service-bus.queue", props: { maxDeliveryCount: 4 } });
    d.edges[0].kind = "async";
  }
  if (preset === "ecs-alb") {
    d.nodes.splice(1, 0, { id: "lb", stencil: "aws.elb", label: "ALB", x: 260, y: 180, props: {} });
    d.edges = [
      { id: "to-lb", from: "source", to: "lb", kind: "sync", props: { travelMs: 10 } },
      { id: "requests", from: "lb", to: "worker", kind: "sync", props: { travelMs: 10 } },
    ];
  }
  const resources = {
    ...resourceLesson(),
    modelRevision: "a2" as const,
    cpuMsPerMessage: pick([0, 10, 100, 1000]),
    cpuLimitMilli: pick([50, 1000]),
    baselineMemoryMiB: pick([0, 100]),
    memoryMiBPerMessage: pick([1, 10, 100]),
    startup: { delayMs: pick([0, 30, 200]), jitterFraction: pick([0, 0.5]) },
    terminationGraceMs: pick([0, 50, 300]),
  };
  const zero = pick([0, 1]);
  const scaler = (): CloudConfig => {
    const a = cloudLesson(preset, { source: "lb", binding: { node: "source" } });
    const c = a.controller;
    Object.assign(c, { minReplicas: c.kind === "appService" ? 1 : zero, maxReplicas: pick([3, 5]) });
    c.initialReplicas = c.minReplicas + pick([0, 1]);
    const cooldown = () => pick([0, 1000, 3000]);
    if (c.kind === "ecs") {
      c.metricPeriodMs = pick([1000, 2000]);
      c.alarm = { outPeriods: pick([1, 2]), inPeriods: pick([1, 3]), inMargin: 0.1 };
      for (const p of c.targetTracking)
        Object.assign(p, {
          scaleOutCooldownMs: cooldown(),
          scaleInCooldownMs: cooldown(),
          disableScaleIn: pick([false, false, true]),
        });
      for (const p of c.stepScaling) Object.assign(p, { cooldownMs: cooldown(), evaluationPeriods: pick([1, 2]) });
      if (preset === "ecs-step" && pick([true, false]))
        c.stepScaling[0].adjustmentType = pick(["PercentChangeInCapacity", "ChangeInCapacity"] as const);
    } else if (c.kind === "aca") {
      Object.assign(c, { pollingMs: 1000, cooldownMs: cooldown() });
      c.settings.syncMs = 1000;
      c.settings.down.stabilizationMs = pick([0, 1000]);
      if (c.http) c.http.concurrentRequests = pick([1, 5]);
    } else if (c.kind === "appService") {
      c.evaluationMs = 1000;
      for (const rule of c.rules) Object.assign(rule, { windowMs: pick([1000, 2000]), cooldownMs: cooldown() });
      c.rules[0].changeType = pick(["ChangeCount", "PercentChangeCount"] as const);
      c.rules[0].value = pick([1, 50]);
    } else if (c.kind === "cloudRun") {
      Object.assign(c, {
        evaluationMs: 1000,
        cpuWindowMs: 1000,
        concurrencyWindowsMs: [1000, pick([1000, 3000])],
        scaleInDelayMs: pick([0, 1000, 3000]),
      });
    }
    return a;
  };
  const admission = () => ({
    quotas: [
      {
        id: "requests",
        unit: "requests" as const,
        amount: pick([1, 5, 20]),
        windowMs: 1000,
        burst: 1,
        algorithm: "token-bucket" as const,
      },
    ],
  });
  worker.props = {
    replicas: pick([1, 2]),
    concurrency: pick([1, 2, 4]),
    latencyMs: pick([10, 100, 500]),
    jitter: 0,
    resources,
    autoscaling: scaler(),
    failureRate: pick([0, 0.5, 1]),
    retry: "inplace",
    retryBackoffMs: pick([0, 100, 300]),
    ...(pick([true, false, false]) ? { api: admission() } : {}),
  };
  for (let i = 0, n = pick([0, 1]); i < n; i++) {
    const node = { ...structuredClone(worker), id: `extra-${i}` };
    d.nodes.push(node);
    d.edges.push({ ...d.edges.find((e) => e.to === "worker")!, id: `extra-edge-${i}`, to: node.id });
  }
  const actions: Action[] = [{ do: "burst", count: 20, ms: 30 }];
  for (let i = 0; i < 70; i++) {
    const ms = pick([10, 100, 1000, 3000]);
    switch (pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      case 9:
        actions.push({ do: "refuse", ms });
        break;
      case 0:
      case 1:
      case 2:
        actions.push({ do: "burst", count: pick([1, 3, 8, 20, 60]), ms });
        break;
      case 3:
        actions.push({ do: "status", status: pick(["up", "paused", "down"]), ms });
        break;
      case 4:
        actions.push({ do: "props", props: { autoscaling: scaler() }, ms });
        break;
      case 5:
        // Disabling mid-run, then a later action may re-enable it.
        actions.push({ do: "props", props: { autoscaling: { mode: "off" }, replicas: pick([1, 2, 3]) }, ms });
        break;
      case 6:
        actions.push({
          do: "props",
          props: pick([
            { replicas: pick([1, 2, 4]) },
            { resumeAutoscaling: true },
            { resources: pick([resources, undefined]) },
          ]),
          ms,
        });
        break;
      case 7:
        actions.push({ do: "props", props: { concurrency: pick([1, 2, 4]) }, ms });
        break;
      default:
        actions.push({ do: "props", props: { api: pick([admission(), undefined]), failureRate: pick([0, 1]) }, ms });
    }
  }
  return {
    d,
    scale: pick([1, 1, 2, 10]),
    actions: actions.map((action) =>
      action.do !== "props"
        ? action
        : {
            ...action,
            unset: Object.keys(action.props).filter((key) => action.props[key as keyof NodeSimProps] === undefined),
            props: Object.fromEntries(Object.entries(action.props).filter(([, value]) => value !== undefined)),
          },
    ),
  };
}
describe("A3 cloud adapter seeded invariants", () => {
  const cases = process.env.A1_FUZZ_NIGHTLY ? 5000 : 140;
  const seeds = process.env.A3_FUZZ_SEED
    ? [Number(process.env.A3_FUZZ_SEED)]
    : Array.from({ length: cases }, (_, i) => i + 1);
  it.each(seeds)("seed %i", (seed) => {
    const { d, scale, actions } = generateCloud(seed);
    const failure = replay(d, seed, scale, actions);
    if (failure)
      throw new Error(
        `A3 seed ${seed} (${CLOUD_PRESETS[seed % CLOUD_PRESETS.length]}), scale ${scale}: ${failure}\nMinimal reproduction: ${JSON.stringify(minimize(d, seed, scale, actions, failure))}`,
      );
    expect(failure).toBeUndefined();
  });
});

/** Minimal reproductions found by the nightly 5,000-seed run, replayed on every run. */
describe("A3 nightly reproductions", () => {
  const repros = JSON.parse(readFileSync("tests/fixtures/autoscaling/a3-nightly-repros.json", "utf8")) as {
    name: string;
    seed: number;
    scale: number;
    diagram: DiagramFile;
    events: Action[];
  }[];
  it.each(repros.map((r) => [r.name, r] as const))("%s", (_, r) => {
    expect(replay(r.diagram, r.seed, r.scale, r.events)).toBeUndefined();
  });
});
