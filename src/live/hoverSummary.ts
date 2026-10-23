import { t } from "../i18n";
import type { DiagramEdge, DiagramFile } from "../model/types";
import { isDependency } from "../model/relations";
import { revisionAtLeast } from "../model/revisions";
import { activeCall, type CompiledTopology } from "../sim/topology";
import { stencilRole } from "../stencils/roles";
import type { BreakerView } from "../sim/breaker";
import type { NodeSimState, EdgeSimState } from "../sim/types";
import { formatCount, formatRate } from "./format";
import { callFailureRate } from "./callFailureRate";
import { isolate } from "./bidi";
import { latencyDuration } from "./latencyFormat";

export interface HoverFact {
  key: string;
  label: string;
  value: string;
  ratio?: number;
  bad?: boolean;
}
export interface HoverProblem {
  key: string;
  text: string;
  severe?: boolean;
}
export interface HoverSummary {
  problems: HoverProblem[];
  vitals: HoverFact[];
  facts: HoverFact[];
  sections: { key: string; label: string; summary: string }[];
}

/** Deliberate product priority. Counters describe recorded outcomes, never invented runtime state. */
export const PROBLEM_PRIORITY = [
  "down",
  "timeout",
  "threads",
  "retry",
  "lag",
  "loss",
  "failed",
  "memory",
  "rejected",
  "unread",
  "failover",
  "paused",
  "waiting",
] as const;
export function nodeSummary(
  s: NodeSimState,
  calls: NonNullable<EdgeSimState["calls"]>[],
  growing = false,
): HoverSummary {
  const busy = s.threads ? s.threads.working + s.threads.waiting : 0;
  const exhausted = !!s.threads && Number.isFinite(s.threads.slots) && busy >= s.threads.slots;
  const timeouts = calls.reduce((n, c) => n + c.timedOut, 0);
  const requests = calls.reduce((n, c) => n + (c.windowRequests ?? 0), 0);
  const attempts = calls.reduce((n, c) => n + (c.windowAttempts ?? 0), 0);
  const retries = calls.reduce((n, c) => n + (c.windowRetried ?? 0), 0);
  const amplification = requests > 0 ? attempts / requests : 1;
  // Dead-lettered messages were moved, not lost: the dead-letter queue keeps them for reading or redrive.
  const lost = s.dropped;
  const broker = ["queue", "topic", "stream"].includes(s.role);
  const candidates: Partial<Record<(typeof PROBLEM_PRIORITY)[number], HoverProblem>> = {
    ...(s.status === "down" && { down: { key: "down", text: t("hover.downVerdict"), severe: true } }),
    ...(timeouts > 0 && {
      timeout: { key: "timeout", text: t("hover.timeoutVerdict", { count: timeouts }), severe: true },
    }),
    ...(exhausted && {
      threads: { key: "threads", text: t("hover.threadsVerdict", { count: formatCount(busy) }), severe: true },
    }),
    ...(amplification >= 1.2 &&
      retries >= 10 && {
        retry: { key: "retry", text: t("hover.retryVerdict", { ratio: amplification.toFixed(1) }), severe: true },
      }),
    ...(broker && growing && !s.noConsumer && { lag: { key: "lag", text: t("hover.lagVerdict") } }),
    ...(lost > 0 && { loss: { key: "loss", text: t("hover.lossVerdict", { count: lost }), severe: true } }),
    ...(s.failed > 0 && { failed: { key: "failed", text: t("hover.failedVerdict", { count: s.failed }) } }),
    ...(s.resources?.unsafe && { memory: { key: "memory", text: t("hover.memoryVerdict"), severe: true } }),
    ...(!!s.rejected && { rejected: { key: "rejected", text: t("hover.rejectedVerdict", { count: s.rejected }) } }),
    ...(s.noConsumer && { unread: { key: "unread", text: t("hover.unreadVerdict") } }),
    ...(s.failingOver && { failover: { key: "failover", text: t("hover.failoverVerdict") } }),
    ...(s.status === "paused" && { paused: { key: "paused", text: t("hover.pausedVerdict") } }),
    ...(s.backlog > 0 && { waiting: { key: "waiting", text: t("hover.waitingVerdict", { count: s.backlog }) } }),
  };
  const problems = PROBLEM_PRIORITY.flatMap((key) => (candidates[key] ? [candidates[key]!] : []));
  const rate = {
    key: "rate",
    label: broker ? t("hover.published") : t("hover.throughput"),
    value: formatRate(s.throughput),
  };
  const loss = { key: "loss", label: t("hover.lost"), value: formatCount(lost), bad: lost > 0 };
  const queue = {
    key: "backlog",
    label: broker ? (s.noConsumer ? t("hover.kept") : t("hover.lag")) : t("hover.queue"),
    value: formatCount(s.backlog),
    bad: growing,
  };
  const cpu = s.resources?.cpuRequestPct ?? s.resources?.cpuAllocatedPct;
  const vitals: HoverFact[] = broker
    ? [
        rate,
        queue,
        { key: "groups", label: t("hover.groupCount"), value: formatCount(Object.keys(s.lag).length) },
        loss,
      ]
    : [
        rate,
        { key: "latency", label: t("hover.p95"), value: s.latency?.samples ? latencyDuration(s.latency.p95) : "—" },
        s.threads
          ? {
              key: "threads",
              label: t("hover.threads"),
              value: `${formatCount(busy)}/${formatCount(s.threads.slots)}`,
              ratio: busy / s.threads.slots,
              bad: exhausted,
            }
          : { key: "inFlight", label: t("hover.inFlight"), value: formatCount(s.inFlight) },
        cpu !== undefined
          ? { key: "cpu", label: t("hover.cpu"), value: `${Math.round(cpu)}%`, ratio: cpu / 100, bad: cpu > 100 }
          : queue,
      ];
  const facts: HoverFact[] = [
    ...problems.slice(1).map((p) => ({ key: p.key, label: p.text, value: "", bad: p.severe })),
    ...(s.deadLettered > 0
      ? [{ key: "deadLettered", label: t("hover.deadLettered"), value: formatCount(s.deadLettered) }]
      : []),
    {
      key: "processed",
      label: s.role === "source" ? t("hover.sent") : t("hover.processed"),
      value: formatCount(s.processed),
    },
    { key: "inFlight", label: t("hover.inFlight"), value: formatCount(s.inFlight) },
  ];
  const sections = broker
    ? [
        {
          key: "outcomes",
          label: t("hover.groups"),
          summary: t("hover.readers", { count: Object.keys(s.lag).length }),
        },
        {
          key: "latency",
          label: t("hover.latency"),
          summary: s.latency?.samples ? latencyDuration(s.latency.p95) : t("hover.noSamples"),
        },
        { key: "planning", label: t("hover.details"), summary: "" },
      ]
    : [
        {
          key: "latency",
          label: t("hover.latency"),
          summary: s.latency?.samples ? latencyDuration(s.latency.p95) : t("hover.noSamples"),
        },
        {
          key: "threads",
          label: t("hover.calls"),
          summary: s.threads
            ? t("hover.workingWaiting", { working: s.threads.working, waiting: s.threads.waiting })
            : t("hover.noWaiting"),
        },
        {
          key: "resources",
          label: t("hover.resources"),
          summary: s.fleet ? t("hover.readyDesired", s.fleet) : t("hover.unknown"),
        },
      ];
  return { problems, vitals, facts, sections };
}

/**
 * What a connection's card describes. `request`: an active call whose caller waits (requests that wait, p3-w1 on):
 * thread, timeout, retry and breaker semantics. `flow`: messages, or a call this model doesn't simulate as waiting.
 * `dependency`: config, secrets and the like, which carry no traffic.
 */
export type EdgeReadoutKind = "request" | "flow" | "dependency";
export function edgeReadoutKind(diagram: DiagramFile, edge: DiagramEdge, topology: CompiledTopology): EdgeReadoutKind {
  if (isDependency(edge)) return "dependency";
  const compiled = topology.edges.find((e) => e.id === edge.id);
  const from = diagram.nodes.find((n) => n.id === edge.from);
  if (!compiled || !from || !revisionAtLeast(diagram.planning?.revision, "p3-w1")) return "flow";
  return activeCall(stencilRole(from.stencil), compiled) ? "request" : "flow";
}

const breakerState = (b: BreakerView) =>
  b.state === "closed"
    ? t("resilience.closedState")
    : b.state === "open"
      ? t("resilience.openState")
      : t("resilience.testingState");

/** An active Request connection: its calls, retries, timeouts and (when it has one) its breaker's runtime state. */
export function requestSummary(
  c: EdgeSimState["calls"] | undefined,
  breaker: BreakerView | undefined,
  blocking: boolean,
  active: number,
): HoverSummary {
  const ratio = (c?.windowRequests ?? 0) > 0 ? (c?.windowAttempts ?? 0) / c!.windowRequests! : 1;
  const failures = callFailureRate(c);
  const problems: HoverProblem[] = [
    ...(breaker?.state === "open"
      ? [
          {
            key: "breaker",
            text: t("hover.breakerOpenVerdict", { seconds: Math.ceil(breaker.remainingMs / 1000) }),
            severe: true,
          },
        ]
      : []),
    // The breaker is current runtime state: it leads cumulative timeout and retry counts.
    ...(breaker?.state === "half-open"
      ? [
          {
            key: "breaker",
            text: t("hover.breakerTestingVerdict", { settled: breaker.probesSettled, probes: breaker.probes }),
          },
        ]
      : []),
    ...(c?.timedOut ? [{ key: "timeout", text: t("hover.timeoutVerdict", { count: c.timedOut }), severe: true }] : []),
    ...(ratio >= 1.2 && (c?.windowRetried ?? 0) >= 10
      ? [{ key: "retry", text: t("hover.retryVerdict", { ratio: ratio.toFixed(1) }), severe: true }]
      : []),
  ];
  return {
    problems,
    vitals: [
      {
        key: "requests",
        label: t("hover.requests"),
        value: c?.windowRequests === undefined ? "—" : formatRate(c.windowRequests / 10),
      },
      { key: "attempts", label: t("hover.attempts"), value: `${ratio.toFixed(1)}×`, bad: ratio >= 1.2 },
      {
        key: "goodput",
        label: t("hover.goodput"),
        value: c?.windowSucceeded === undefined ? "—" : formatRate(c.windowSucceeded / 10),
      },
      { key: "flight", label: t("hover.inFlight"), value: formatCount(c?.inFlight ?? active) },
    ],
    facts: [
      ...problems.slice(1).map((p) => ({ key: p.key, label: p.text, value: "", bad: p.severe })),
      { key: "held", label: blocking ? t("hover.holds") : t("hover.frees"), value: formatCount(c?.held ?? 0) },
      {
        key: "failureRate",
        label: t("resilience.failureScope"),
        value: failures.available ? isolate(`${Math.round(100 * failures.rate)}%`) : "—",
      },
    ],
    sections: [
      { key: "retries", label: t("hover.retries"), summary: formatCount(c?.retried ?? 0) },
      { key: "timeouts", label: t("hover.timeouts"), summary: "" },
      { key: "breaker", label: t("hover.breaker"), summary: breaker ? breakerState(breaker) : "—" },
    ],
  };
}

/** A message flow, or a dependency: what moved over it, with no caller-thread, retry or timeout semantics. */
export function flowSummary(kind: "flow" | "dependency", s: EdgeSimState | undefined): HoverSummary {
  return {
    problems: [],
    vitals:
      kind === "dependency"
        ? []
        : [
            { key: "delivered", label: t("hover.delivered"), value: formatCount(s?.delivered ?? 0) },
            { key: "flight", label: t("hover.inFlight"), value: formatCount(s?.active ?? 0) },
          ],
    facts: [],
    sections: [],
  };
}
