import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Check, Demo, Tutorial, UiStep, Words } from "../types";
import { studyAdd, studyRun } from "./studyShared";

const channels = [
  {
    worker: "emailSender",
    provider: "email",
    queue: "emailQueue",
    dlq: "emailDlq",
    stencil: "generic.queue",
    search: stencilSearch("generic.queue"),
  },
  {
    worker: "smsSender",
    provider: "sms",
    queue: "smsQueue",
    dlq: "smsDlq",
    stencil: "aws.sqs",
    search: stencilSearch("aws.sqs"),
  },
  {
    worker: "pushSender",
    provider: "push",
    queue: "pushQueue",
    dlq: "pushDlq",
    stencil: "azure.service-bus.queue",
    search: stencilSearch("azure.service-bus.queue"),
  },
] as const;

const channelConfiguration = (): Check[] =>
  channels.flatMap(({ worker, provider, queue, dlq }) => [
    { kind: "relation", from: "events", to: queue, relation: "flow", edgeKind: "async" },
    { kind: "relation", from: queue, to: worker, relation: "flow", edgeKind: "async" },
    { kind: "relation", from: queue, to: dlq, relation: "flow", edgeKind: "async" },
    { kind: "prop", subject: queue, prop: "maxDeliveryCount", op: "=", value: 2 },
    { kind: "prop", edge: [queue, dlq], prop: "dlq", op: "=", value: true },
    { kind: "prop", edge: [worker, provider], prop: ["caller", "poolConnections"], effective: true, op: "=", value: 1 },
  ]);

const poolSolution = (provider: string, first: boolean): UiStep[] => [
  { click: "fit-view-button" },
  { click: `node-{${provider}}` },
  { press: "Control+Alt+[" },
  ...(first ? [{ click: "inspector-section-edge-simulation" }, { click: "inspector-section-call-advanced" }] : []),
  { fill: "inspector-field-poolConnections", text: "1" },
  { press: "Enter" },
];
/** Each provider's pool of one connection, in the diagram and in every run that would override it. */
const poolRepairs = (runs: readonly [string, ...string[]]): Demo[] =>
  channels.map<Demo>(({ worker, provider }) => ({
    kind: "patch",
    edge: [worker, provider],
    runs,
    patches: [{ op: "set", path: ["caller", "poolConnections"], value: 1 }],
  }));
const queueSolution = (worker: string, search: Words): UiStep[] => [
  { rightclick: `edge-label-{events->${worker}}` },
  { click: "context-menu-item-edge.relationship" },
  { click: "context-menu-item-relation:message" },
  { rightclick: `edge-label-{events->${worker}}` },
  { click: "context-menu-item-edge.insert-node" },
  { type: search },
  { press: "Enter" },
  { press: "Enter" },
];

export const studyFanout: Tutorial = {
  id: "study-fanout",
  version: 2,
  track: "studies",
  level: 3,
  minutes: 25,
  study: true,
  title: msg("tutorials.studyFanout.title"),
  summary: msg("tutorials.studyFanout.summaryV2"),
  start: () => ({
    format: "diagrams/v2",
    title: t("tutorials.studyFanout.title"),
    planning: { revision: "p3-w2" },
    nodes: [
      {
        id: "source",
        stencil: "generic.webhook",
        label: t("tutorials.studyFanout.source"),
        x: 0,
        y: 0,
        props: { ratePerSec: 8 },
      },
      {
        id: "events",
        stencil: "generic.service",
        label: t("tutorials.studyFanout.events"),
        x: 280,
        y: 0,
        props: { concurrency: 100, latencyMs: 10, jitter: 0 },
      },
      {
        id: "email-sender",
        stencil: "service.python",
        label: t("tutorials.studyFanout.emailSender"),
        x: 600,
        y: -300,
        props: { concurrency: 100, latencyMs: 10, jitter: 0 },
      },
      {
        id: "sms-sender",
        stencil: "service.java",
        label: t("tutorials.studyFanout.smsSender"),
        x: 600,
        y: 0,
        props: { concurrency: 100, latencyMs: 10, jitter: 0 },
      },
      {
        id: "push-sender",
        stencil: "service.go",
        label: t("tutorials.studyFanout.pushSender"),
        x: 600,
        y: 300,
        props: { concurrency: 100, latencyMs: 10, jitter: 0 },
      },
      ...[
        {
          id: "email",
          stencil: "generic.email",
          label: t("tutorials.studyFanout.email"),
          y: -300,
          amount: 4,
          latencyMs: 250,
        },
        { id: "sms", stencil: "generic.sms", label: t("tutorials.studyFanout.sms"), y: 0, amount: 2, latencyMs: 500 },
        {
          id: "push",
          stencil: "generic.push",
          label: t("tutorials.studyFanout.push"),
          y: 300,
          amount: 6,
          latencyMs: 200,
        },
      ].map(({ amount, latencyMs, ...node }) => ({
        ...node,
        x: 950,
        props: {
          api: {
            latencyMs,
            quotas: [
              {
                id: "provider",
                unit: "requests" as const,
                amount,
                windowMs: 1000,
                burst: amount,
                algorithm: "token-bucket" as const,
              },
            ],
          },
        },
      })),
    ],
    edges: [
      { id: "source-events", from: "source", to: "events", kind: "sync" },
      ...["email", "sms", "push"].flatMap((channel) => [
        {
          id: `events-${channel}`,
          from: "events",
          to: `${channel}-sender`,
          kind: "sync" as const,
          label:
            channel === "email"
              ? t("tutorials.studyFanout.email")
              : channel === "sms"
                ? t("tutorials.studyFanout.sms")
                : t("tutorials.studyFanout.push"),
        },
        { id: `${channel}-provider`, from: `${channel}-sender`, to: channel, kind: "sync" as const },
      ]),
    ],
    simulations: [
      {
        ...studyRun("provider-limits", msg("tutorials.studyFanout.limitsRun")),
        traffic: [{ id: "events", node: "source", shape: { kind: "constant", ratePerSec: 8, durationMs: 10_000 } }],
      },
      {
        ...studyRun("sms-outage", msg("tutorials.studyFanout.outageRun")),
        traffic: [{ id: "events", node: "source", shape: { kind: "constant", ratePerSec: 4, durationMs: 10_000 } }],
        timeline: [
          { atMs: 1000, action: { do: "status", node: "sms", status: "down" } },
          { atMs: 4000, action: { do: "status", node: "sms", status: "up" } },
        ],
        expectations: [
          {
            id: "email-during-outage",
            label: t("tutorials.studyFanout.emailDuringOutage"),
            metric: { node: "email", field: "processed" },
            op: ">=",
            value: 4,
            when: "at",
            atMs: 3500,
          },
          {
            id: "push-during-outage",
            label: t("tutorials.studyFanout.pushDuringOutage"),
            metric: { node: "push", field: "processed" },
            op: ">=",
            value: 4,
            when: "at",
            atMs: 3500,
          },
        ],
      },
    ],
  }),
  subjects: {
    events: { stencils: ["generic.service"] },
    emailSender: { stencils: ["service.python"] },
    smsSender: { stencils: ["service.java"] },
    pushSender: { stencils: ["service.go"] },
    email: { stencils: ["generic.email"] },
    sms: { stencils: ["generic.sms"] },
    push: { stencils: ["generic.push"] },
    // A channel's main queue sits on its router → sender flow; its DLQ only hangs off the queue (same stencil).
    emailQueue: { stencils: ["generic.queue"], between: ["events", "emailSender"] },
    smsQueue: { stencils: ["aws.sqs"], between: ["events", "smsSender"] },
    pushQueue: { stencils: ["azure.service-bus.queue"], between: ["events", "pushSender"] },
    emailDlq: { stencils: ["generic.queue"], downstreamOf: "emailQueue" },
    smsDlq: { stencils: ["aws.sqs"], downstreamOf: "smsQueue" },
    pushDlq: { stencils: ["azure.service-bus.queue"], downstreamOf: "pushQueue" },
  },
  steps: [
    {
      id: "respect-provider-limits",
      title: msg("tutorials.studyFanout.limitsTitle"),
      goal: () => t("tutorials.studyFanout.limitsGoalV2", { limitsRun: t("tutorials.studyFanout.limitsRun") }),
      hint: msg("tutorials.studyFanout.limitsHintV2"),
      note: {
        title: msg("tutorials.studies.checklist"),
        text: () => t("tutorials.studyFanout.checklistV2", { outageRun: t("tutorials.studyFanout.outageRun") }),
      },
      done: msg("tutorials.studyFanout.limitsDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "provider-limits", atLeastMs: 5000 },
          ...channels.flatMap<Check>(({ provider }) => [
            { kind: "metric", subject: provider, field: "rejected", op: "=", value: 0 },
            { kind: "metric", subject: provider, field: "processed", op: ">=", value: 3 },
          ]),
        ],
      },
      targets: [{ testId: "node-{sms}", tip: msg("tutorials.studyFanout.limitsHintV2") }],
      demo: [...poolRepairs(["provider-limits", "sms-outage"]), { kind: "runSimulation", id: "provider-limits" }],
      solution: [
        ...channels.flatMap(({ provider }, i) => poolSolution(provider, i === 0)),
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "provider-limits" },
      ],
    },
    {
      id: "dead-letter-each-channel",
      title: msg("tutorials.studyFanout.queuesTitle"),
      goal: msg("tutorials.studyFanout.queuesGoalV2"),
      hint: msg("tutorials.studyFanout.queuesHintV2"),
      note: {
        title: msg("tutorials.studies.checklist"),
        text: () => t("tutorials.studyFanout.checklistV2", { outageRun: t("tutorials.studyFanout.outageRun") }),
      },
      done: msg("tutorials.studyFanout.queuesDone"),
      check: {
        kind: "all",
        checks: channels.flatMap<Check>(({ worker, queue, dlq }) => [
          { kind: "relation", from: "events", to: queue, relation: "flow", edgeKind: "async" },
          { kind: "relation", from: queue, to: worker, relation: "flow", edgeKind: "async" },
          { kind: "relation", from: queue, to: dlq, relation: "flow", edgeKind: "async" },
          { kind: "prop", edge: [queue, dlq], prop: "dlq", op: "=", value: true },
          { kind: "prop", subject: queue, prop: "maxDeliveryCount", op: "=", value: 2 },
        ]),
      },
      targets: [{ testId: "node-{events}", tip: msg("tutorials.studyFanout.queuesHintV2") }],
      demo: channels.flatMap<Demo>(({ worker, queue, dlq, stencil }) => [
        { kind: "insert", edge: ["events", worker], subject: queue, stencil },
        { kind: "relation", from: "events", to: queue, relation: "flow", edgeKind: "async" },
        { kind: "relation", from: queue, to: worker, relation: "flow", edgeKind: "async" },
        { kind: "patch", subject: queue, patches: [{ op: "set", path: ["maxDeliveryCount"], value: 2 }] },
        { kind: "add", subject: dlq, stencil, after: queue },
        { kind: "relation", from: queue, to: dlq, relation: "flow", edgeKind: "async" },
        { kind: "patch", edge: [queue, dlq], patches: [{ op: "set", path: ["dlq"], value: true }] },
      ]),
      solution: [
        { click: "coach-fold" },
        { click: "live-toggle" },
        ...channels.flatMap<UiStep>(({ worker, search }, i) => [
          ...queueSolution(worker, search),
          ...(i === 0 ? [{ click: "inspector-section-node-simulation" }] : []),
          { fill: "inspector-field-maxDeliveryCount", text: "2" },
          { press: "Enter" },
          { click: "inspector-field-label" },
          { press: "Enter" },
          ...studyAdd(null, search),
          { press: "Control+Alt+[" },
          { click: "inspector-field-dlq" },
        ]),
      ],
    },
    {
      id: "survive-sms-outage",
      title: msg("tutorials.studyFanout.outageTitle"),
      goal: () => t("tutorials.studyFanout.outageGoalV2", { outageRun: t("tutorials.studyFanout.outageRun") }),
      hint: msg("tutorials.studyFanout.outageHintV2"),
      note: {
        title: msg("tutorials.studies.checklist"),
        text: () => t("tutorials.studyFanout.checklistV2", { outageRun: t("tutorials.studyFanout.outageRun") }),
      },
      done: msg("tutorials.studyFanout.outageDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "sms-outage", atLeastMs: 6000 },
          ...channelConfiguration(),
          { kind: "expectation", simulation: "sms-outage", label: msg("tutorials.studyFanout.emailDuringOutage") },
          { kind: "expectation", simulation: "sms-outage", label: msg("tutorials.studyFanout.pushDuringOutage") },
          { kind: "metric", subject: "smsQueue", field: "deadLettered", op: ">=", value: 1 },
          { kind: "metric", subject: "smsDlq", field: "processed", op: ">=", value: 1 },
          ...channels.flatMap<Check>(({ provider }) => [
            { kind: "metric", subject: provider, field: "processed", op: ">=", value: 3 },
            { kind: "metric", subject: provider, field: "rejected", op: "=", value: 0 },
          ]),
          { kind: "compare", left: { sum: "failed", nodes: ["emailSender", "pushSender"] }, op: "=", right: 0 },
        ],
      },
      targets: [{ testId: "node-{smsQueue}", tip: msg("tutorials.studyFanout.outageHintV2"), dim: false }],
      // The outage also judges each provider's quota: a pool the learner widened in this run since is put back first.
      demo: [...poolRepairs(["sms-outage"]), { kind: "runSimulation", id: "sms-outage" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "sms-outage" }],
    },
  ],
  finish: {
    text: msg("tutorials.studyFanout.finishV2"),
    example: { slug: "notification-fanout", label: msg("tutorials.studyFanout.reference") },
  },
};
