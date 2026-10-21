import type { DiagramOp } from "../ai";
import type { CheckContext } from "./context";
import type { CheckFix, CheckRule, Finding } from "./types";
import { revisionAtLeast } from "../model/revisions";
import { callPolicy, callResponseMs } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";
import { affordableTimeout } from "../live/affordableTimeout";
import { confirmedThreadFix } from "../live/threadFixPlan";
import type { TroubleAction } from "../live/observedTrouble";
import { threadCapacity } from "./threadCapacity";
import { scaleFix } from "./scaleFix";
import { scenarioPlans } from "../sim/scalingPlanner";
import { offThreadPlans } from "../lib/scenarioPlanner";
import { rememberedRequestChecks } from "../lib/requestCheckCache";
import { profileOf } from "../stencils/profiles";
import { emptyInputs, freePlayProps, freePlayScale } from "../live/capacityModel";
import { DEFAULT_SEED } from "../live/storm";
import { simulationContent } from "../sim/simulationContent";
import { scalingFixLabel } from "./scalingFindings";
import { resourcePlan } from "../sim/resourcePlanning";
import { resolvedTiming } from "../sim/timing";

const cache = new WeakMap<CheckContext, Finding[]>();
const contentCache = new Map<string, Finding[]>();
const round = (n: number) => Math.round(n * 1000) / 1000;
const FIX_WORK = 2_000_000;

/** All verified findings, including rules the diagram turned off. The worker sends
 * this complete cache so main-thread rechecks share its capacity suppression. */
export function checkedRequests(d: CheckContext["diagram"]): Finding[] | undefined {
  return contentCache.get(simulationContent(d));
}

/** Exact edit values from #225's selector, never another ranking or timeout formula. */
export function threadCheckFix(d: CheckContext["diagram"], action: TroubleAction | undefined): CheckFix | undefined {
  if (!action) return;
  if (action.kind === "scale-threads")
    return {
      label: scalingFixLabel(action.plan),
      planLabel: action.plan,
      ops: action.changes.map((c) => ({ op: "update", target: c.node, props: c.props })),
    };
  if (action.kind !== "free-thread" && action.kind !== "add-timeout") return;
  const edge = d.edges.find((e) => e.id === action.edge);
  return {
    label: action.kind === "free-thread" ? "Free the thread while waiting" : `Add a ${action.deadlineMs} ms timeout`,
    requestLabel: action.kind === "free-thread" ? { kind: "free" } : { kind: "timeout", value: action.deadlineMs },
    ops: [
      {
        op: "update",
        target: action.edge,
        props: {
          caller: {
            ...(edge?.props?.caller as object | undefined),
            ...(action.kind === "free-thread" ? { wait: "non-blocking" } : { deadlineMs: action.deadlineMs }),
          },
        },
      },
    ],
  };
}

/** Capacity Checks concern the diagram's rates; saved drills deliberately overload services.
 * Replays run in the Checks worker. Main-thread readers use its exact cached findings. */
export function requestFindings(ctx: CheckContext): Finding[] {
  if (!revisionAtLeast(ctx.diagram.planning?.revision, "p3-w1")) return [];
  if (!ctx.local && offThreadPlans(ctx.diagram)) return rememberedRequestChecks(ctx.diagram) ?? [];
  const known = cache.get(ctx);
  if (known) return known;
  const d = ctx.diagram,
    key = simulationContent(d);
  const remembered = contentCache.get(key);
  if (remembered) return remembered;
  const analysis = ctx.capacity();
  const findings: Finding[] = [];
  let remainingWork = FIX_WORK;
  cache.set(ctx, findings);
  if (contentCache.size >= 8) contentCache.delete(contentCache.keys().next().value!);
  contentCache.set(key, findings);
  for (const node of d.nodes) {
    const n = analysis.nodes[node.id],
      p = analysis.resolved[node.id],
      w = n.waits;
    for (const e of ctx.requests(node.id)) {
      const target = ctx.nodes.get(e.to)!;
      if (!target || !["external-api", "model-api"].includes(profileOf(target.stencil)?.family ?? "")) continue;
      const edge = ctx.edges.get(e.id)!;
      const policy = callPolicy(node.stencil, edge.props?.caller as EdgeSimProps["caller"]);
      if (policy.deadlineMs !== undefined) continue;
      const response = analysis.nodes[e.to].waits?.memoryResidenceMs ?? resolvedTiming(analysis.resolved[e.to]).workMs;
      const deadline = affordableTimeout(
        response + 2 * (Number(edge.props?.networkDelayMs) || 0),
        n.waits?.slots ?? p.replicas * p.concurrency,
        n.offered,
      );
      const descriptor: NonNullable<Finding["requestFinding"]> = {
        kind: "timeout",
        name: ctx.name(node.id),
        callee: ctx.name(e.to),
        hold: 0,
        waiting: 0,
        rate: n.offered,
        needed: 0,
        slots: 0,
        replicas: n.replicas,
        concurrency: p.concurrency,
        deadline,
        blocking: policy.blocking,
      };
      const action: TroubleAction =
        deadline === undefined
          ? { kind: "free-thread", edge: e.id }
          : { kind: "add-timeout", edge: e.id, deadlineMs: deadline };
      // A non-blocking call still needs a deadline; freeing it again would change nothing.
      const fix = deadline !== undefined ? threadCheckFix(d, action) : undefined;
      findings.push({
        id: `call-timeout:${e.id}`,
        rule: "call-timeout",
        severity: "suggestion",
        target: e.id,
        elements: [e.id, node.id, e.to],
        title: `No timeout on the call to ${ctx.name(e.to)}`,
        message: policy.blocking
          ? "If it stalls, every thread waits."
          : "If it stalls, the call stays in flight indefinitely.",
        rationale: "A timeout bounds waiting; downstream work can still finish and reply late.",
        requestFinding: descriptor,
        ...(fix ? { fix } : {}),
      });
    }
    if (
      n.role !== "processor" ||
      !w ||
      !(w.callMs > w.workMs) ||
      !Number.isFinite(w.threadHoldMs) ||
      n.utilization < 1 ||
      n.status
    )
      continue;
    if (threadCapacity(ctx).nodes[node.id].utilization < 1) continue;
    // Diagnose the call that sets the hold ceiling, independent of connection order.
    let longest = -1;
    const edge = ctx.requests(node.id).reduce<ReturnType<CheckContext["requests"]>[number] | undefined>((found, e) => {
      const input = ctx.edges.get(e.id)!;
      const policy = callPolicy(node.stencil, input.props?.caller as EdgeSimProps["caller"]);
      if (!policy.blocking) return found;
      const response =
        analysis.nodes[e.to].waits?.memoryResidenceMs ??
        resolvedTiming(analysis.resolved[e.to], 0, e.endpointId).workMs;
      const hold = callResponseMs(policy, response + 2 * (Number(input.props?.networkDelayMs) || 0));
      if (hold <= longest) return found;
      longest = hold;
      return e;
    }, undefined);
    if (!edge) continue;
    const inputs = emptyInputs();
    const simulation = {
      id: "free-play",
      title: "Free play",
      seed: DEFAULT_SEED,
      scale: freePlayScale(d, inputs),
      durationMs: 60000,
      traffic: [],
      setup: { props: freePlayProps(d, inputs) },
      multipliers: { capacity: 1 },
    };
    const work = (simulation.durationMs / 10) * (d.nodes.length + d.edges.length) * 7;
    const action =
      work <= remainingWork
        ? confirmedThreadFix({
            context: { revision: 0, origin: { diagram: d, simulation, initialTraffic: true }, controls: [] },
            trouble: {
              key: `threads-exhausted:${node.id}`,
              kind: "threads-exhausted",
              node: node.id,
              headline: "",
              announce: "",
              detail: "",
              action: { kind: "free-thread", edge: edge.id },
            },
            time: 15000,
          })
        : undefined;
    remainingWork -= work;
    const fix = threadCheckFix(d, action);
    if (fix) {
      const options: NonNullable<CheckFix["options"]> = [];
      if (action?.kind === "scale-threads") {
        const free = threadCheckFix(d, { kind: "free-thread", edge: edge.id })!;
        options.push({ ...free, short: free.label, ops: free.ops! });
      }
      const scale = scaleFix(ctx, n, p.autoscaling?.mode === "on");
      if (scale?.ops) {
        const replicas = scale.ops.flatMap((o) =>
          o.op === "update" && o.target === node.id ? [o.props?.replicas] : [],
        )[0];
        options.push({
          label: scale.label,
          short: typeof replicas === "number" ? "Add replicas" : scale.label,
          ...(typeof replicas === "number" ? { requestLabel: { kind: "replicas" as const, value: replicas } } : {}),
          ops: scale.ops,
        });
      }
      if (action?.kind !== "scale-threads") {
        const suggestion = (scenarioPlans(d) ?? [])
          .flatMap((p) => p.suggestions)
          .find((s) => s.node === node.id && s.kind === "busyThreads" && s.fix && s.verified);
        if (suggestion?.fix)
          options.push({
            label: "Scale on busy threads",
            short: "Scale on busy threads",
            requestLabel: { kind: "scale" },
            ops: suggestion.fix.map((c): DiagramOp => ({ op: "update", target: c.node, props: c.props })),
          });
      }
      if (options.length) fix.options = options;
    }
    const descriptor: NonNullable<Finding["requestFinding"]> = {
      kind: "blocked",
      name: ctx.name(node.id),
      callee: ctx.name(edge.to),
      hold: round(w.threadHoldMs),
      waiting: round(w.callMs),
      rate: round(n.offered),
      needed: Math.ceil((n.offered * w.threadHoldMs) / 1000),
      slots: w.slots,
      replicas: n.activeReplicas,
      concurrency: p.concurrency,
    };
    findings.push({
      id: `blocked-threads:${node.id}`,
      rule: "blocked-threads",
      severity: "warning",
      target: node.id,
      elements: [node.id, edge.id, edge.to],
      title: `${descriptor.name} runs out of threads`,
      message: `It holds a thread for ${descriptor.hold} ms per request (${descriptor.waiting} ms waiting on ${descriptor.callee}). At ${descriptor.rate} req/s it needs ${descriptor.needed} threads; it has ${descriptor.slots} (${descriptor.replicas} replicas × ${descriptor.concurrency}).`,
      rationale:
        "Waiting calls occupy threads without using CPU. A fix is offered only after a same-seed rerun confirms it.",
      requestFinding: descriptor,
      ...(fix ? { fix } : {}),
    });
    if (action?.kind === "scale-threads" && action.plan.kind === "busyThreads") {
      const controller = p.autoscaling?.mode === "on" ? p.autoscaling.controller : undefined;
      const cpuRule =
        controller && "settings" in controller
          ? controller.settings.metrics.find((m) => m.source.kind === "resource" && m.source.resource === "cpu")
          : undefined;
      const cpu = resourcePlan(p, Math.min(n.offered, n.capacity), n.activeReplicas, 1, w)?.cpuRequestPct;
      const target =
        cpuRule?.target.kind === "utilization"
          ? cpuRule.target.percentOfRequest
          : cpuRule?.target.kind === "averageValue" && p.resources?.cpuRequestMilli
            ? (cpuRule.target.value / p.resources.cpuRequestMilli) * 100
            : undefined;
      findings.push({
        id: `scaling-blind:${node.id}`,
        rule: "scaling-blind",
        severity: "warning",
        target: node.id,
        elements: [node.id, edge.id],
        title: `${descriptor.name} scales on CPU, but its threads wait`,
        message:
          cpu !== undefined && target !== undefined
            ? `At full load it uses ${Math.round(cpu)}% CPU against a ${Math.round(target)}% target while the backlog grows. A same-seed rerun confirmed scaling on busy threads.`
            : "CPU stays below its target while the backlog grows. A same-seed rerun confirmed scaling on busy threads.",
        rationale: "Busy threads counts working threads and threads waiting on calls; CPU only sees work.",
        requestFinding: {
          ...descriptor,
          kind: "blind",
          cpu: cpu === undefined ? undefined : Math.round(cpu),
          target: target === undefined ? undefined : Math.round(target),
        },
        fix: threadCheckFix(d, action),
      });
    }
  }
  return findings;
}

export const blockedThreads: CheckRule = {
  id: "blocked-threads",
  name: "Runs out of threads",
  about:
    "At the diagram's rates, waiting on calls dominates thread hold time and exhausts the pool. Uses the live callout's same-seed verified fix.",
  detect: (ctx) => requestFindings(ctx).filter((f) => f.rule === "blocked-threads"),
};
export const scalingBlind: CheckRule = {
  id: "scaling-blind",
  name: "CPU scaling misses waiting threads",
  about: "A same-seed scenario rerun confirms a busy-thread scaling policy for a waiting caller.",
  detect: (ctx) => requestFindings(ctx).filter((f) => f.rule === "scaling-blind"),
};
export const callTimeout: CheckRule = {
  id: "call-timeout",
  name: "Call has no timeout",
  about:
    "A request to an outside API or model API has no deadline. Suggests the timeout the live callout uses, within the caller's thread budget.",
  detect: (ctx) => requestFindings(ctx).filter((f) => f.rule === "call-timeout"),
};
