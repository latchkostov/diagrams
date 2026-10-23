import { t } from "../i18n";
import type { NodeSimState, EdgeSimState } from "../sim/types";
import { formatCount, formatRate } from "./format";
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
  const lost = s.dropped + s.deadLettered;
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
    ...problems.map((p) => ({ key: p.key, label: p.text, value: "", bad: p.severe })),
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
