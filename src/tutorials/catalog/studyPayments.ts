import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { studyAdd, studyRun } from "./studyShared";

export const studyPayments: Tutorial = {
  id: "study-payments",
  version: 1,
  // quarantined: see docs/backlog/2026-10-24-tutorials-quarantine.md
  quarantined: true,
  track: "studies",
  level: 3,
  minutes: 25,
  study: true,
  title: msg("tutorials.studyPayments.title"),
  summary: msg("tutorials.studyPayments.summary"),
  start: () => ({
    format: "diagrams/v2",
    title: t("tutorials.studyPayments.title"),
    planning: { revision: "p3-w2" },
    nodes: [
      {
        id: "checkout",
        stencil: "client.browser",
        label: t("tutorials.studyPayments.checkout"),
        x: 0,
        y: 0,
        props: { ratePerSec: 20 },
      },
      {
        id: "payments",
        stencil: "generic.service",
        label: t("tutorials.studyPayments.payments"),
        x: 300,
        y: 0,
        props: { replicas: 4, concurrency: 10, latencyMs: 10, jitter: 0 },
      },
      {
        id: "psp",
        stencil: "generic.external-api",
        label: t("tutorials.studyPayments.psp"),
        x: 600,
        y: -160,
        props: { api: { latencyMs: 100 } },
      },
    ],
    edges: [
      { id: "checkout-payments", from: "checkout", to: "payments", kind: "sync" },
      {
        id: "payments-psp",
        from: "payments",
        to: "psp",
        kind: "sync",
        props: {
          caller: {
            retry: {
              maxAttempts: 2,
              backoffMs: 100,
              strategy: "exponential",
              retryOn: ["timeout", "transient"],
              idempotent: false,
            },
          },
        },
      },
    ],
    simulations: [
      {
        ...studyRun("psp-brownout", msg("tutorials.studyPayments.brownoutRun")),
        traffic: [{ id: "charges", node: "checkout", shape: { kind: "constant", ratePerSec: 20, durationMs: 12_000 } }],
        timeline: [{ atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "psp", factor: 10 } } }],
      },
      {
        ...studyRun("poison-disputes", msg("tutorials.studyPayments.poisonRun")),
        traffic: [
          {
            id: "disputes",
            node: "checkout",
            messageType: t("tutorials.studyPayments.disputeType"),
            shape: { kind: "constant", ratePerSec: 4, durationMs: 12_000 },
          },
        ],
      },
    ],
  }),
  subjects: {
    checkout: { stencils: ["client.browser"] },
    payments: { stencils: ["generic.service"] },
    psp: { stencils: ["generic.external-api"] },
    outbox: { stencils: ["kafka.topic"] },
    consumer: { stencils: ["service.java"] },
    dlq: { stencils: ["aws.sqs"] },
  },
  steps: [
    {
      id: "never-double-charge",
      title: msg("tutorials.studyPayments.safeTitle"),
      goal: msg("tutorials.studyPayments.safeGoal"),
      hint: msg("tutorials.studyPayments.safeHint"),
      done: msg("tutorials.studyPayments.safeDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "relation", from: "payments", to: "outbox", relation: "flow", edgeKind: "async" },
          { kind: "relation", from: "outbox", to: "consumer", relation: "flow", edgeKind: "async" },
          { kind: "prop", edge: ["payments", "psp"], prop: ["caller", "retry", "idempotent"], op: "=", value: true },
        ],
      },
      targets: [{ testId: "node-{payments}", tip: msg("tutorials.studyPayments.safeHint") }],
      demo: [
        { kind: "add", subject: "outbox", stencil: "kafka.topic", after: "payments" },
        { kind: "add", subject: "consumer", stencil: "service.java", after: "outbox" },
        { kind: "relation", from: "payments", to: "outbox", relation: "flow", edgeKind: "async" },
        { kind: "relation", from: "outbox", to: "consumer", relation: "flow", edgeKind: "async" },
        {
          kind: "patch",
          edge: ["payments", "psp"],
          patches: [{ op: "set", path: ["caller", "retry", "idempotent"], value: true }],
        },
      ],
      solution: [
        ...studyAdd("payments", msg("tutorials.studyPayments.searchTopic")),
        ...studyAdd(null, msg("tutorials.studyPayments.searchConsumer")),
        { click: "fit-view-button" },
        { click: "node-{psp}" },
        { press: "Control+Alt+[" },
        { click: "inspector-section-edge-simulation" },
        { click: "inspector-section-retry-safety" },
        { click: "inspector-field-retry-idempotent" },
        { click: "context-menu-item-true" },
      ],
    },
    {
      id: "survive-psp-brownout",
      title: msg("tutorials.studyPayments.brownoutTitle"),
      goal: msg("tutorials.studyPayments.brownoutGoal"),
      hint: msg("tutorials.studyPayments.brownoutHint"),
      done: msg("tutorials.studyPayments.brownoutDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "prop", edge: ["payments", "psp"], prop: ["caller", "deadlineMs"], op: ">=", value: 1 },
          { kind: "prop", edge: ["payments", "psp"], prop: ["caller", "deadlineMs"], op: "<=", value: 250 },
          { kind: "simulation", id: "psp-brownout", atLeastMs: 3000 },
          { kind: "metric", subject: "payments", edge: ["payments", "psp"], field: "breaker", op: "=", value: "open" },
        ],
      },
      targets: [{ testId: "node-{psp}", tip: msg("tutorials.studyPayments.brownoutHint") }],
      demo: [
        {
          kind: "patch",
          edge: ["payments", "psp"],
          patches: [
            { op: "set", path: ["caller", "deadlineMs"], value: 250 },
            { op: "set", path: ["caller", "breaker"], value: {} },
          ],
        },
        { kind: "runSimulation", id: "psp-brownout" },
      ],
      solution: [
        { click: "inspector-field-breaker-on" },
        { hover: "inspector-section-breaker-details" },
        { fill: "inspector-field-deadlineMs", text: "250" },
        { press: "Enter" },
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "psp-brownout" },
      ],
    },
    {
      id: "dead-letter-disputes",
      title: msg("tutorials.studyPayments.poisonTitle"),
      goal: msg("tutorials.studyPayments.poisonGoal"),
      hint: msg("tutorials.studyPayments.poisonHint"),
      done: msg("tutorials.studyPayments.poisonDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "relation", from: "outbox", to: "dlq", relation: "flow", edgeKind: "async" },
          { kind: "prop", edge: ["outbox", "dlq"], prop: "dlq", op: "=", value: true },
          { kind: "simulation", id: "poison-disputes", atLeastMs: 4000 },
          { kind: "metric", subject: "outbox", field: "deadLettered", op: ">=", value: 1 },
          { kind: "metric", subject: "dlq", field: "processed", op: ">=", value: 1 },
        ],
      },
      targets: [{ testId: "node-{outbox}", tip: msg("tutorials.studyPayments.poisonHint") }],
      demo: [
        { kind: "add", subject: "dlq", stencil: "aws.sqs", after: "outbox" },
        { kind: "live" },
        // Restore waits for the edge's subject, including a reused queue's deferred connection.
        { kind: "fault", edge: ["outbox", "dlq"], fault: "cut", restore: true },
        { kind: "relation", from: "outbox", to: "dlq", relation: "flow", edgeKind: "async" },
        { kind: "patch", edge: ["outbox", "dlq"], patches: [{ op: "set", path: ["dlq"], value: true }] },
        { kind: "patch", subject: "consumer", patches: [{ op: "set", path: ["failureRate"], value: 1 }] },
        { kind: "runSimulation", id: "poison-disputes" },
      ],
      solution: [
        { click: "live-toggle" },
        ...studyAdd("outbox", msg("tutorials.studyPayments.searchQueue")),
        { click: "node-{outbox}" },
        { press: "Control+Alt+]" },
        { press: "Control+Alt+]" },
        { click: "inspector-field-dlq" },
        { click: "fit-view-button" },
        { dblclick: "node-{consumer}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-failureRate", text: "1" },
        { press: "Enter" },
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "poison-disputes" },
      ],
    },
  ],
  finish: {
    text: msg("tutorials.studyPayments.finish"),
    example: { slug: "payments-ledger", label: msg("tutorials.studyPayments.reference") },
  },
};
