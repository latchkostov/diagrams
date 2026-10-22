import type { DiagramEdge } from "../model/types";
import type { DiagramOp } from "../ai";
import type { CheckContext } from "./context";
import type { CheckFix, CheckRule, Finding } from "./types";
import { revisionAtLeast } from "../model/revisions";
import { callPolicy, callResponseMs } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";
import { affordableTimeout } from "../live/affordableTimeout";
import { confirmedThreadFix, THREAD_FIX_WORK, threadFixWork } from "../live/threadFixPlan";
import type { TroubleAction } from "../live/observedTrouble";
import { threadCapacity } from "./threadCapacity";
import { scaleFix } from "./scaleFix";
import {
  hasRequestCheckProvider,
  rememberedRequestChecks,
  rememberRequestChecks,
  requestCheckResult,
} from "../lib/requestCheckCache";
import { profileOf } from "../stencils/profiles";
import { emptyInputs, freePlayProps, freePlayScale } from "../live/capacityModel";
import { DEFAULT_SEED } from "../live/storm";
import { scalingFixLabel } from "./scalingFindings";
import { resourcePlan } from "../sim/resourcePlanning";
import { requestResponseMs } from "../sim/timing";
import { activeCall } from "../sim/topology";
import { fitsRef } from "./context";
import type { Simulation } from "../model/types";

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Names repeated in findings are bounded: a call's finding repeats its callee's name, so one long imported label
 * would otherwise be copied once per connection into the worker's reply, the cache and the Checks card. The file
 * format's own label limit; never cut inside a character. The diagram keeps its labels.
 */
export const FINDING_NAME_MAX = 200;
export function findingName(name: string): string {
  if (name.length <= FINDING_NAME_MAX) return name;
  // Characters, not UTF-16 units: a prefix twice the limit holds more than the limit's characters if any are cut.
  const chars = Array.from(name.slice(0, 2 * FINDING_NAME_MAX + 2));
  return chars.length <= FINDING_NAME_MAX ? name : `${chars.slice(0, FINDING_NAME_MAX - 1).join("")}…`;
}

/**
 * At most this many characters of request findings (as JSON) per diagram, so a diagram with thousands of calls can't
 * build a reply too big to send or show. Warnings come first; past the budget, later timeout suggestions (in diagram
 * order) are left out. Normal diagrams use a small fraction of it.
 */
export const REQUEST_FINDINGS_BUDGET = 1_000_000;

/**
 * Whether edit ops can name every element these change: an imported id longer than an op reference allows can't be
 * edited by a fix (the finding stays, without one).
 */
const referable = (ops: readonly DiagramOp[]) => ops.every((o) => !("target" in o) || fitsRef(String(o.target)));

/** Exact edit values from #225's selector, never another ranking or timeout formula. Only fixes ops can apply. */
export function threadCheckFix(
  d: CheckContext["diagram"],
  action: TroubleAction | undefined,
  edge?: DiagramEdge,
): CheckFix | undefined {
  const fix = threadFixOf(d, action, edge);
  return fix?.ops && referable(fix.ops) ? fix : undefined;
}

function threadFixOf(
  d: CheckContext["diagram"],
  action: TroubleAction | undefined,
  edge?: DiagramEdge,
): CheckFix | undefined {
  if (!action) return;
  if (action.kind === "scale-threads")
    return {
      label: scalingFixLabel(action.plan),
      planLabel: action.plan,
      ops: action.changes.map((c) => ({ op: "update", target: c.node, props: c.props })),
    };
  if (action.kind !== "free-thread" && action.kind !== "add-timeout") return;
  // Callers with the edge at hand pass it: a diagram's worth of timeout fixes stays linear.
  const input = edge?.id === action.edge ? edge : d.edges.find((e) => e.id === action.edge);
  return {
    label: action.kind === "free-thread" ? "Free the thread while waiting" : `Add a ${action.deadlineMs} ms timeout`,
    requestLabel: action.kind === "free-thread" ? { kind: "free" } : { kind: "timeout", value: action.deadlineMs },
    ops: [
      {
        op: "update",
        target: action.edge,
        props: {
          caller: {
            ...(input?.props?.caller as object | undefined),
            ...(action.kind === "free-thread" ? { wait: "non-blocking" } : { deadlineMs: action.deadlineMs }),
          },
        },
      },
    ],
  };
}

/** One context's request findings: given by a caller that awaited them, or worked out once. */
const known = new WeakMap<CheckContext, Finding[]>();

/** Request findings already awaited (awaitRequestChecks) for this context's diagram: runChecks reads these. */
export function provideRequestFindings(ctx: CheckContext, findings: Finding[]): void {
  known.set(ctx, findings);
}

/**
 * Capacity Checks concern the diagram's rates; saved drills deliberately overload services.
 * Replays run in the Checks worker. Main-thread readers use its exact findings: given (awaited first), else cached;
 * with a worker registered and neither, this throws rather than report a clean result.
 */
export function requestFindings(ctx: CheckContext): Finding[] {
  if (!revisionAtLeast(ctx.diagram.planning?.revision, "p3-w1")) return [];
  const given = known.get(ctx);
  if (given) return given;
  const remembered = rememberedRequestChecks(ctx.diagram);
  if (remembered) {
    known.set(ctx, remembered);
    return remembered;
  }
  if (!ctx.local && hasRequestCheckProvider()) {
    const result = requestCheckResult(ctx.diagram);
    throw result?.status === "failed"
      ? result.error
      : new Error("Request checks are pending. Await request checks before reading findings.");
  }
  const findings = computeRequestFindings(ctx);
  known.set(ctx, findings);
  rememberRequestChecks(ctx.diagram, findings);
  return findings;
}

function computeRequestFindings(ctx: CheckContext): Finding[] {
  const d = ctx.diagram;
  const analysis = ctx.capacity();
  const name = (id: string) => findingName(ctx.name(id));
  const warnings: Finding[] = [];
  const suggestions: Finding[] = [];
  // Timeout suggestions past the whole budget can't be reported (warnings go first): none is built, only counted.
  let suggested = 0;
  let unbuilt = 0;
  let remainingWork = THREAD_FIX_WORK;
  let simulation: Simulation | undefined;
  for (const node of d.nodes) {
    const n = analysis.nodes[node.id],
      p = analysis.resolved[node.id],
      w = n.waits;
    // The calls playback makes: not dead-letter routes, deny rules or connections that forward no share.
    const calls = ctx.requests(node.id).filter((e) => activeCall(ctx.role(node.id), e));
    for (const e of calls) {
      const target = ctx.nodes.get(e.to);
      if (!target || !["external-api", "model-api"].includes(profileOf(target.stencil)?.family ?? "")) continue;
      const edge = ctx.edges.get(e.id)!;
      const policy = callPolicy(node.stencil, edge.props?.caller as EdgeSimProps["caller"]);
      if (policy.deadlineMs !== undefined) continue;
      if (suggested > REQUEST_FINDINGS_BUDGET) {
        unbuilt++;
        continue;
      }
      const response = requestResponseMs(
        analysis.resolved[e.to],
        analysis.nodes[e.to].waits,
        e.endpointId,
        Number(edge.props?.networkDelayMs) || 0,
      );
      const deadline = affordableTimeout(
        response,
        n.waits?.slots ?? p.replicas * p.concurrency,
        n.offered,
        Number(edge.props?.networkDelayMs) || 0,
      );
      const callee = name(e.to);
      const descriptor: NonNullable<Finding["requestFinding"]> = {
        kind: "timeout",
        name: name(node.id),
        callee,
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
      // A non-blocking call still needs a deadline; freeing it again would change nothing.
      const fix =
        deadline !== undefined
          ? threadCheckFix(d, { kind: "add-timeout", edge: e.id, deadlineMs: deadline }, edge)
          : undefined;
      const suggestion: Finding = {
        id: `call-timeout:${e.id}`,
        rule: "call-timeout",
        severity: "suggestion",
        target: e.id,
        elements: [e.id, node.id, e.to],
        title: `No timeout on the call to ${callee}`,
        message: policy.blocking
          ? "If it stalls, every thread waits."
          : "If it stalls, the call stays in flight indefinitely.",
        rationale: "A timeout bounds waiting; downstream work can still finish and reply late.",
        requestFinding: descriptor,
        ...(fix ? { fix } : {}),
      };
      suggested += JSON.stringify(suggestion).length + 1;
      suggestions.push(suggestion);
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
    const edge = calls.reduce<(typeof calls)[number] | undefined>((found, e) => {
      const input = ctx.edges.get(e.id)!;
      const policy = callPolicy(node.stencil, input.props?.caller as EdgeSimProps["caller"]);
      if (!policy.blocking) return found;
      const response = requestResponseMs(
        analysis.resolved[e.to],
        analysis.nodes[e.to].waits,
        e.endpointId,
        Number(input.props?.networkDelayMs) || 0,
      );
      const hold = callResponseMs(policy, response);
      if (hold <= longest) return found;
      longest = hold;
      return e;
    }, undefined);
    if (!edge) continue;
    const input = ctx.edges.get(edge.id);
    const work = threadFixWork(d.nodes.length, d.edges.length);
    if (work <= remainingWork && !simulation) {
      const inputs = emptyInputs();
      simulation = {
        id: "free-play",
        title: "Free play",
        seed: DEFAULT_SEED,
        scale: freePlayScale(d, inputs),
        durationMs: 60000,
        traffic: [],
        setup: { props: freePlayProps(d, inputs) },
        multipliers: { capacity: 1 },
      };
    }
    const action =
      work <= remainingWork && simulation
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
    if (work <= remainingWork) remainingWork -= work;
    const fix = threadCheckFix(d, action, input);
    if (fix) {
      const options: NonNullable<CheckFix["options"]> = [];
      // Every option's ops must name what they change, as the fix's must.
      const offer = (option: NonNullable<CheckFix["options"]>[number]) => {
        if (referable(option.ops)) options.push(option);
      };
      if (action?.kind === "scale-threads") {
        const free = threadCheckFix(d, { kind: "free-thread", edge: edge.id }, input);
        if (free?.ops) offer({ ...free, short: free.label, ops: free.ops });
      }
      const scale = scaleFix(ctx, n, p.autoscaling?.mode === "on");
      if (scale?.ops) {
        const replicas = scale.ops.flatMap((o) =>
          o.op === "update" && o.target === node.id ? [o.props?.replicas] : [],
        )[0];
        // Sizing a consumer can add partitions to the broker it reads: the chip says so, never only "Add replicas".
        const brokers = scale.brokerChanges;
        offer({
          label: scale.label,
          short: typeof replicas === "number" && !brokers ? "Add replicas" : scale.label,
          ...(typeof replicas === "number" ? { requestLabel: { kind: "replicas" as const, value: replicas } } : {}),
          ...(brokers ? { brokerChanges: brokers } : {}),
          ops: scale.ops,
        });
      }
      if (action?.kind !== "scale-threads") {
        // Scenario sizing only here, for a blocked caller with a verified fix (lazy: it plays the simulations).
        const suggestion = (ctx.plans() ?? [])
          .flatMap((p) => p.suggestions)
          .find((s) => s.node === node.id && s.kind === "busyThreads" && s.fix && s.verified);
        if (suggestion?.fix)
          offer({
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
      name: name(node.id),
      callee: name(edge.to),
      hold: round(w.threadHoldMs),
      waiting: round(w.callMs),
      rate: round(n.offered),
      needed: Math.ceil((n.offered * w.threadHoldMs) / 1000),
      slots: w.slots,
      replicas: n.activeReplicas,
      concurrency: p.concurrency,
    };
    warnings.push({
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
      warnings.push({
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
        fix: threadCheckFix(d, action, input),
      });
    }
  }
  // The budget, in a fixed order: every warning that fits, then timeout suggestions in diagram order. What doesn't
  // fit is counted per rule, so a reader never takes a bounded result for a complete one.
  const findings: Finding[] = [];
  const omitted = new Map<Finding["rule"], number>(unbuilt ? [["call-timeout", unbuilt]] : []);
  let room = REQUEST_FINDINGS_BUDGET;
  // Suggestions are a prefix in diagram order: after the first that doesn't fit, none is listed.
  let full = false;
  for (const f of [...warnings, ...suggestions]) {
    const size = JSON.stringify(f).length + 1;
    if (size > room || (full && f.severity === "suggestion")) {
      if (f.severity === "suggestion") full = true;
      omitted.set(f.rule, (omitted.get(f.rule) ?? 0) + 1);
      continue;
    }
    room -= size;
    findings.push(f);
  }
  for (const [rule, count] of omitted) findings.push(omission(rule, count));
  return findings;
}

/** How many of a rule's findings didn't fit the budget: runChecks reports it as `omitted`, never as a finding. */
function omission(rule: Finding["rule"], count: number): Finding {
  return {
    id: `${rule}:*omitted`,
    rule,
    severity: "suggestion",
    target: "",
    elements: [],
    title: "",
    message: "",
    rationale: "",
    omitted: count,
  };
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
