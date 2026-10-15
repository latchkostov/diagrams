import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import type { NodeSimProps, NodeStatus } from "./types";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { createEngine } from "./engine";
import { mulberry32 } from "./rng";
import { assertResourceInvariants } from "./resourceInvariants";
import { analyzeCapacity } from "./capacity";
import { resolveNodeProps } from "./defaults";

type Action = { ms: number } & (
  | { do: "burst"; count: number }
  | { do: "status"; status: NodeStatus }
  | { do: "props"; props: NodeSimProps; unset?: string[] }
);
function generate(seed: number) {
  const random = mulberry32(seed),
    pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
  const d = autoscalingFixture();
  const broker = pick([true, false]);
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
    autoscaling: pick([hpa(), { mode: "off" as const }]),
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
  const actions: Action[] = [];
  for (let i = 0; i < 70; i++) {
    const ms = pick([10, 30, 100, 300]);
    switch (pick([0, 1, 2, 3, 4, 5, 6, 7, 8])) {
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
        actions.push({ do: "props", props: { autoscaling: hpa() }, ms });
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
    e.load(d);
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
      else
        e.setNodeProps("worker", {
          ...action.props,
          ...Object.fromEntries((action.unset ?? []).map((key) => [key, undefined])),
        });
      e.step(action.ms); // The diagnostic runs after EVERY internal 10 ms step.
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
    : Array.from({ length: cases }, (_, i) => i + 1);
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
