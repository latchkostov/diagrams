import type { DiagramEdge } from "../model/types";
import type { DiagramOp } from "../ai";
import type { EdgeSimProps } from "../sim/types";
import type { CheckContext } from "./context";
import type { CheckFix, CheckRule, Finding } from "./types";
import { fitsRef, MAX_BATCH } from "./context";
import { findingBudget, findingName, omission } from "./findingBudget";
import { revisionAtLeast } from "../model/revisions";
import { activeCall } from "../sim/topology";
import { callPolicy } from "../sim/callPolicy";
import { STEP, requestResponseMs } from "../sim/timing";
import { profileOf } from "../stencils/profiles";
import { RECOMMENDED_RETRY, recommendedQueue, retryIdempotency } from "../sim/resiliencePresets";
import { confirmedResilienceFix, type RecoveryEvidence } from "../live/resilienceFixPlan";
import { freePlaySimulation, THREAD_FIX_LIMITS, THREAD_FIX_WORK } from "../live/threadFixPlan";

type Kind = NonNullable<Finding["resilienceFinding"]>["kind"];
export const RESILIENCE_RULES: readonly Kind[] = [
  "retry-backoff",
  "retry-budget",
  "retry-idempotency",
  "retry-layers",
  "call-breaker",
  "queue-limit",
  "retry-storm",
];
export const RESILIENCE_ABOUT: Record<Kind, { name: string; about: string }> = {
  "retry-backoff": {
    name: "Retries need jittered backoff",
    about: "Retries without backoff or jitter arrive in waves. Checks active Requests on p3-w2.",
  },
  "retry-budget": {
    name: "Retries need a budget",
    about: "A retry budget limits added load when a dependency fails. Checks active Requests on p3-w2.",
  },
  "retry-idempotency": {
    name: "Retries may repeat a side effect",
    about: "A timed-out request may have succeeded. Checks explicit idempotency and the request route method.",
  },
  "retry-layers": {
    name: "Retries multiply across layers",
    about: "Attempts multiply down a Request chain. Warns above ten attempts at the innermost dependency.",
  },
  "call-breaker": {
    name: "Failing dependencies need a circuit breaker",
    about:
      "A breaker fails calls fast while a dependency keeps failing. Checks retried external, model and failure-prone calls.",
  },
  "queue-limit": {
    name: "Queues can outlive the caller",
    about:
      "At configured rates an overloaded processor can queue work past its caller's deadline. Suggests a wait and queue limit.",
  },
  "retry-storm": {
    name: "A slowdown could become a retry storm",
    about:
      "Probes up to three retried Requests at configured rates: slow the callee fivefold at 5 s, clear at 10 s, replay to 30 s. Offers only the first cumulative fix proven to recover.",
  },
};

const callerOf = (e: DiagramEdge) => e.props?.caller as EdgeSimProps["caller"];
const attemptsOf = (e: DiagramEdge) => Math.min(10, Math.max(1, callerOf(e)?.retry?.maxAttempts ?? 1));
const usable = (fix: CheckFix): CheckFix | undefined =>
  fix.ops && fix.ops.length <= MAX_BATCH && fix.ops.every((o) => !("target" in o) || fitsRef(String(o.target)))
    ? fix
    : undefined;
const update = (edge: DiagramEdge, caller: NonNullable<EdgeSimProps["caller"]>): DiagramOp => ({
  op: "update",
  target: edge.id,
  props: { caller },
});
const fix = (label: string, kind: string, ops: DiagramOp[], value?: number, name?: string): CheckFix | undefined =>
  usable({ label, resilienceLabel: { kind, value, name }, ops });

/** Static arithmetic uses the context's graph and capacity once; replays are bounded across all three probes. */
export function computeResilienceFindings(ctx: CheckContext): Finding[] {
  if (!revisionAtLeast(ctx.diagram.planning?.revision, "p3-w2")) return [];
  const calls = ctx.topology.edges.filter((e) => activeCall(ctx.role(e.from), e)).map((e) => ctx.edges.get(e.id)!);
  if (!calls.length) return [];
  const findings: Finding[] = [],
    omitted = new Map<Kind, number>(),
    budget = findingBudget();
  const methods = new Map(ctx.diagram.planning?.requestRoutes?.map((r) => [r.id, r.address.method]));
  const names = new Map<string, string>();
  const name = (id: string) => {
    const known = names.get(id);
    if (known !== undefined) return known;
    const value = findingName(ctx.name(id));
    names.set(id, value);
    return value;
  };
  const emit = (f: Finding) => {
    // Reserve against every emitted byte, including escaped authored values in fix ops. Names are already clipped.
    if (budget.take(outputStrings(f))) findings.push(f);
    else omitted.set(f.rule as Kind, (omitted.get(f.rule as Kind) ?? 0) + 1);
  };
  const make = (
    kind: Kind,
    e: DiagramEdge,
    title: string,
    message: string,
    action?: CheckFix,
    extra: Partial<NonNullable<Finding["resilienceFinding"]>> = {},
    severity: Finding["severity"] = "warning",
  ): Finding => ({
    id: `${kind}:${e.id}`,
    rule: kind,
    severity,
    target: e.id,
    elements: [e.id, e.from, e.to],
    title,
    message,
    rationale: "Retries add load when a dependency is struggling. Bound repeated work and keep it safe to repeat.",
    resilienceFinding: {
      kind,
      caller: name(e.from),
      callee: name(e.to),
      attempts: attemptsOf(e),
      amplification: attemptsOf(e),
      ...extra,
    },
    ...(action ? { fix: action } : {}),
  });
  for (const e of calls) {
    const caller = callerOf(e),
      retry = caller?.retry,
      m = attemptsOf(e),
      callee = name(e.to);
    if (retry && m >= 2) {
      if (retry.backoffMs < 2 * STEP || !retry.jitter)
        emit(
          make(
            "retry-backoff",
            e,
            `Retries to ${callee} need jittered backoff.`,
            `${name(e.from)} retries in step with every other caller: waves of retries reach ${callee} together.`,
            fix("Use jittered backoff (100 ms ×2, up to 2 s, full jitter)", "jitter", [
              update(e, {
                ...caller,
                retry: {
                  ...retry,
                  backoffMs: RECOMMENDED_RETRY.backoffMs,
                  strategy: RECOMMENDED_RETRY.strategy,
                  maxBackoffMs: RECOMMENDED_RETRY.maxBackoffMs,
                  jitter: RECOMMENDED_RETRY.jitter,
                },
              }),
            ]),
          ),
        );
      if (!retry.budget)
        emit(
          make(
            "retry-budget",
            e,
            `No retry budget on the call to ${callee}.`,
            `If ${callee} slows down, ${m} attempts per request multiply its load by ${m}.`,
            fix("Add a 20% retry budget", "budget", [
              update(e, { ...caller, retry: { ...retry, budget: { ...RECOMMENDED_RETRY.budget! } } }),
            ]),
            { budgetPercent: RECOMMENDED_RETRY.budget!.percent },
            m >= 3 ? "warning" : "suggestion",
          ),
        );
      const method = methods.get(String(e.props?.requestRouteId ?? ""));
      if (
        retryIdempotency(retry, method) === false &&
        retry.retryOn.some((c) => c === "timeout" || c === "transient")
      ) {
        const action = fix("Retry only throttled responses", "throttled", [
          update(e, { ...caller, retry: { ...retry, retryOn: ["throttled"] } }),
        ]);
        if (action)
          action.options = [
            {
              label: "It's idempotent (it has an idempotency key)",
              short: "It's idempotent",
              resilienceLabel: { kind: "idempotent" },
              ops: [update(e, { ...caller, retry: { ...retry, idempotent: true } })],
            },
          ];
        emit(
          make(
            "retry-idempotency",
            e,
            `Retries to ${callee} may repeat a ${method ?? "side effect"}.`,
            "A timed-out request may have succeeded; repeating it can charge twice.",
            action,
            { method: method ?? "side effect" },
          ),
        );
      }
      const target = ctx.nodes.get(e.to)!,
        family = profileOf(target.stencil)?.family;
      if (
        !caller?.breaker &&
        (["external-api", "model-api"].includes(family ?? "") || ctx.capacity().resolved[e.to].failureRate > 0)
      )
        emit(
          make(
            "call-breaker",
            e,
            `No circuit breaker on the call to ${callee}.`,
            `If ${callee} keeps failing, every caller keeps trying it.`,
            fix("Add a circuit breaker (50% over 10 s, open 5 s)", "breaker", [update(e, { ...caller, breaker: {} })]),
            {},
            "suggestion",
          ),
        );
    }
    const deadline = callPolicy(ctx.nodes.get(e.from)!.stencil, caller).deadlineMs;
    if (deadline !== undefined && ctx.role(e.to) === "processor") {
      const analysis = ctx.capacity(),
        n = analysis.nodes[e.to],
        p = analysis.resolved[e.to];
      if (
        p.queue?.limit === undefined &&
        p.queue?.maxWaitMs === undefined &&
        !p.admission &&
        !n.status &&
        n.offered > n.capacity
      ) {
        const response = requestResponseMs(
          p,
          n.waits,
          typeof e.props?.endpointId === "string" ? e.props.endpointId : undefined,
          Number(e.props?.networkDelayMs ?? 0),
        );
        const queue = recommendedQueue(deadline, response, n.activeReplicas * p.concurrency, n.capacity);
        emit(
          make(
            "queue-limit",
            e,
            `${callee} queues without limit.`,
            `Under overload, requests wait longer than ${name(e.from)}'s ${deadline / 1000} s timeout, and ${callee} works on requests nobody is waiting for.`,
            queue
              ? fix(
                  `Shed requests that wait over ${queue.maxWaitMs} ms`,
                  "queue",
                  [{ op: "update", target: e.to, props: { queue } }],
                  queue.maxWaitMs,
                )
              : undefined,
            { deadlineMs: deadline, queueLimit: queue?.limit, maxWaitMs: queue?.maxWaitMs },
            "suggestion",
          ),
        );
      }
    }
  }
  // Longest multiplicative path on the Request DAG. Cycles belong to sync-cycle; no recursive walk or path enumeration.
  const incoming = new Map<string, number>(),
    out = new Map<string, DiagramEdge[]>(),
    product = new Map<string, number>(),
    parent = new Map<string, DiagramEdge>();
  for (const n of ctx.diagram.nodes) incoming.set(n.id, 0);
  for (const e of calls) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }
  const ready = [...incoming].filter(([, n]) => !n).map(([id]) => id);
  for (let head = 0; head < ready.length; head++)
    for (const e of out.get(ready[head]) ?? []) {
      const next = Math.min(1e12, (product.get(e.from) ?? 1) * attemptsOf(e));
      if (next > (product.get(e.to) ?? 1)) {
        product.set(e.to, next);
        parent.set(e.to, e);
      }
      incoming.set(e.to, incoming.get(e.to)! - 1);
      if (!incoming.get(e.to)) ready.push(e.to);
    }
  for (const id of ready) {
    const value = product.get(id) ?? 1;
    if (value <= 10 || out.has(id)) continue;
    const chain: DiagramEdge[] = [];
    let e = parent.get(id);
    while (e && chain.length <= MAX_BATCH) {
      chain.push(e);
      e = parent.get(e.from);
    }
    chain.reverse();
    const outer = chain.find((c) => attemptsOf(c) > 1)!,
      last = chain.at(-1)!;
    const retried = chain.filter((c) => attemptsOf(c) > 1),
      path = chain
        .slice(0, 6)
        .map((c) => name(c.from))
        .concat(name(id))
        .join(" → ");
    emit(
      make(
        "retry-layers",
        last,
        `Retries multiply across ${retried.length} layers.`,
        `${path}: up to ${value}× the load on ${name(id)}.`,
        e
          ? undefined
          : fix(
              `Retry only at ${name(outer.from)}`,
              "outer",
              retried
                .filter((c) => c !== outer)
                .map((c) => update(c, { ...callerOf(c), retry: { ...callerOf(c)!.retry!, maxAttempts: 1 } })),
              undefined,
              name(outer.from),
            ),
        { layers: retried.length, amplification: value, path },
      ),
    );
  }
  const candidates = calls
    .filter((e) => attemptsOf(e) >= 2)
    .sort(
      (a, b) =>
        (product.get(b.from) ?? 1) * attemptsOf(b) - (product.get(a.from) ?? 1) * attemptsOf(a) ||
        ctx.rank(a.id) - ctx.rank(b.id) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const work = { work: THREAD_FIX_WORK, messages: { remaining: THREAD_FIX_LIMITS.messages } };
  let notChecked = Math.max(0, candidates.length - 3);
  for (const e of candidates.slice(0, 3)) {
    let before: RecoveryEvidence | undefined, replay: NonNullable<Finding["resilienceFinding"]>["replay"];
    const simulation = {
      ...freePlaySimulation(ctx.diagram),
      durationMs: 30000,
      timeline: [
        {
          atMs: 5000,
          action: {
            do: "fault" as const,
            fault: { kind: "slow" as const, node: e.to, factor: 5 as const },
            drill: "slow-dependency" as const,
          },
        },
        {
          atMs: 10000,
          action: { do: "fault" as const, fault: { kind: "slow" as const, node: e.to, factor: 1 as const } },
        },
      ],
    };
    const action = confirmedResilienceFix({
      context: { revision: 0, origin: { diagram: ctx.diagram, simulation, initialTraffic: true }, controls: [] },
      edge: e.id,
      time: 0,
      budget: work,
      baseline: (b) => {
        before = b;
        return b.points.some((p) => p.time >= b.clear && p.storm);
      },
      proven: (b, a, step) => {
        replay = {
          step,
          recoveredAfterMs: recoveryAfter(a, b)!,
          beforeIntegral: b.integral,
          afterIntegral: a.integral,
        };
      },
    });
    if (!before) {
      notChecked++;
      continue;
    }
    if (!before.points.some((p) => p.time >= before!.clear && p.storm)) continue;
    const recoveredAfterMs = recoveryAfter(before),
      callee = name(e.to);
    emit(
      make(
        "retry-storm",
        e,
        `A slowdown at ${callee} would become a retry storm.`,
        `In a 5 s slowdown (×5), retries keep ${callee} overloaded ${recoveredAfterMs === undefined ? "at least 20" : recoveredAfterMs / 1000} s after it recovers.` +
          (replay
            ? ` ${resilienceChange(replay.step)} The replayed change recovers in ${replay.recoveredAfterMs / 1000} s; successful work after clearing rises from ${replay.beforeIntegral} to ${replay.afterIntegral}.`
            : " No fix was proven within the replay budget."),
        action && replay
          ? fix("Apply proven recovery policy", "proven", [
              update(e, action.caller),
              ...(action.queue
                ? [{ op: "update" as const, target: action.queue.node, props: { queue: action.queue.policy } }]
                : []),
            ])
          : undefined,
        {
          recoveredAfterMs,
          ...(action?.queue ? { queueLimit: action.queue.policy.limit, maxWaitMs: action.queue.policy.maxWaitMs } : {}),
          probe: {
            slowdown: 5,
            startMs: 5000,
            clearMs: 10000,
            horizonMs: 30000,
            recovered: recoveredAfterMs !== undefined,
          },
          replay,
        },
      ),
    );
  }
  if (notChecked) findings.push({ ...omission("retry-storm", 0), unchecked: notChecked });
  for (const [rule, count] of omitted) findings.push(omission(rule, count));
  return findings;
}

/** Reserve before serialization, even when hostile ids or fields repeat across many fixes. */
function* outputStrings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (typeof value === "number") yield String(value);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* outputStrings(item);
    }
  }
}

export function recoveryAfter(e: RecoveryEvidence, baseline = e): number | undefined {
  const p = e.points.find(
    (p) =>
      p.time >= baseline.clear &&
      baseline.preGoodput > 0 &&
      p.goodput >= 0.9 * baseline.preGoodput &&
      p.backlog <= baseline.preBacklog + baseline.threads &&
      p.amplification <= 1.5,
  );
  return p ? p.time - baseline.clear : undefined;
}

function resilienceChange(step: string): string {
  switch (step) {
    case "jitter":
      return "Uses 100 ms exponential backoff, capped at 2 s, with full jitter.";
    case "budget":
      return "Uses jittered backoff and a 20% retry budget (at least 10 retries/s).";
    case "breaker":
      return "Uses jittered backoff, a 20% retry budget and a circuit breaker (50% over 10 s, open 5 s).";
    case "shedding":
      return "Uses jittered backoff, a 20% retry budget, a circuit breaker and a deadline-based queue limit.";
    default:
      return "Uses jittered backoff, a 20% retry budget, a circuit breaker, any proposed queue limit and at most 2 attempts.";
  }
}

export function resilienceRules(read: (ctx: CheckContext) => Finding[]): CheckRule[] {
  return RESILIENCE_RULES.map((id) => ({
    id,
    ...RESILIENCE_ABOUT[id],
    detect(ctx) {
      if (!revisionAtLeast(ctx.diagram.planning?.revision, "p3-w2")) return [];
      const all = read(ctx);
      const storms = ctx.ran?.has("retry-storm")
        ? new Map(all.filter((f) => f.rule === "retry-storm" && !f.unchecked && !f.omitted).map((f) => [f.target, f]))
        : new Map<string, Finding>();
      return all.filter(
        (f) => f.rule === id && (!(id === "retry-budget" || id === "call-breaker") || !storms.has(f.target)),
      );
    },
  }));
}
