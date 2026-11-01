import { diagnosticLesson } from "./diagnosticLesson";
import referenceText from "../../examples/slow-payment-provider.json?raw";
import type { DiagramFile } from "../../model/types";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { liveStep, patchStep, runStep } from "./waitingSteps";

// Keep the public example’s independently retryable download out of the tutorial module graph.
const reference = JSON.parse(referenceText) as DiagramFile;

const lesson: Tutorial = {
  id: "timeouts-pools",
  version: 3,
  track: "waiting",
  level: 2,
  minutes: 5,
  title: msg("tutorials.timeoutsPools.title"),
  summary: msg("tutorials.timeoutsPools.summaryV3"),
  start: { example: "slow-payment-provider" },
  subjects: {
    checkout: { stencils: ["generic.service"] },
    payment: { stencils: ["generic.external-api"] },
    orders: { stencils: ["generic.database"] },
  },
  steps: [
    runStep(
      "run-no-timeouts",
      "no-timeouts",
      {
        title: msg("tutorials.timeoutsPools.runTitle"),
        goal: msg("tutorials.timeoutsPools.runGoal"),
        done: msg("tutorials.timeoutsPools.runDone"),
      },
      true,
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "no-timeouts", atLeastMs: 5000 },
          // Seed 17 fills 100 threads after the slowdown; >=1 has well over 30% margin.
          { kind: "compare", left: { node: "checkout", metric: "threads.waiting" }, op: ">=", right: 1 },
        ],
      },
    ),
    patchStep(
      "timeout-600",
      { edge: ["checkout", "payment"] },
      [{ op: "set", path: ["caller", "deadlineMs"], value: 600 }],
      { kind: "prop", edge: ["checkout", "payment"], prop: ["caller", "deadlineMs"], op: "=", value: 600 },
      "inspector-field-deadlineMs",
      [
        { click: "live-toggle" },
        { dblclick: "edge-{checkout->payment}" },
        { open: "inspector-section-edge-simulation" },
        { fill: "inspector-field-deadlineMs", text: "600" },
        { press: "Enter" },
      ],
      {
        title: msg("tutorials.timeoutsPools.timeoutTitleV3"),
        goal: msg("tutorials.timeoutsPools.timeoutGoal"),
        done: msg("tutorials.timeoutsPools.timeoutDone"),
      },
    ),
    liveStep("live-run-timeout-600", {
      kind: "prop",
      edge: ["checkout", "payment"],
      prop: ["caller", "deadlineMs"],
      op: "=",
      value: 600,
    }),
    runStep(
      "run-timeout-600",
      "timeout-600",
      {
        title: msg("tutorials.timeoutsPools.timeoutRunTitle"),
        goal: msg("tutorials.timeoutsPools.timeoutRunGoalV3"),
        done: msg("tutorials.timeoutsPools.timeoutRunDoneV3"),
      },
      false,
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "timeout-600", atLeastMs: 5000 },
          // Seed 17 at 5 s: timeouts > 1 / 0.7 (waiting.test.ts), so >0 has over 30% margin.
          // The engine exposes timeout totals through this saved expectation, not a node snapshot field.
          // eslint-disable-next-line local/no-literal-ui-text -- stable saved expectation id
          { kind: "expectation", simulation: "timeout-600", label: "payments-timeout" },
        ],
      },
    ),
    patchStep(
      "pool-40",
      { edge: ["checkout", "payment"] },
      [{ op: "set", path: ["caller", "poolConnections"], value: 40 }],
      { kind: "prop", edge: ["checkout", "payment"], prop: ["caller", "poolConnections"], op: "=", value: 40 },
      "inspector-field-poolConnections",
      [
        { click: "live-toggle" },
        { dblclick: "edge-{checkout->payment}" },
        { open: "inspector-section-call-advanced" },
        { fill: "inspector-field-poolConnections", text: "40" },
        { press: "Enter" },
      ],
      {
        title: msg("tutorials.timeoutsPools.poolTitleV3"),
        goal: msg("tutorials.timeoutsPools.poolGoal"),
        done: msg("tutorials.timeoutsPools.poolDone"),
      },
    ),
    liveStep("live-run-pool-40", {
      kind: "prop",
      edge: ["checkout", "payment"],
      prop: ["caller", "poolConnections"],
      op: "=",
      value: 40,
    }),
    runStep(
      "run-pool-40",
      "pool-40",
      {
        title: msg("tutorials.timeoutsPools.poolRunTitle"),
        goal: msg("tutorials.timeoutsPools.poolRunGoalV3"),
        done: msg("tutorials.timeoutsPools.poolRunDoneV3"),
      },
      false,
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "pool-40", atLeastMs: 5000 },
          {
            kind: "prop",
            edge: ["checkout", "payment"],
            prop: ["caller", "deadlineMs"],
            effective: true,
            op: "=",
            value: 600,
          },
          {
            kind: "prop",
            edge: ["checkout", "payment"],
            prop: ["caller", "poolConnections"],
            effective: true,
            op: "=",
            value: 40,
          },
          { kind: "compare", left: { edge: ["checkout", "payment"], metric: "calls.inFlight" }, op: "<=", right: 40 },
          { kind: "compare", left: { edge: ["checkout", "payment"], metric: "calls.timedOut" }, op: ">=", right: 1 },
          { kind: "compare", left: { edge: ["checkout", "payment"], metric: "calls.late" }, op: ">=", right: 1 },
        ],
      },
    ),
  ],
  finish: { text: msg("tutorials.timeoutsPools.finishV3") },
};

export const timeoutsPools = diagnosticLesson(lesson, () => structuredClone(reference) as DiagramFile);
