import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { moment, runStep } from "./waitingSteps";

export const sharedApiQuotas: Tutorial = {
  id: "shared-api-quotas",
  version: 1,
  track: "resilience",
  level: 2,
  minutes: 3,
  title: msg("tutorials.sharedApiQuotas.title"),
  summary: msg("tutorials.sharedApiQuotas.summary"),
  // Pre-running the later comparison would latch its step before the burst.
  start: { example: "shared-api-quotas" },
  subjects: {
    answer: { stencils: ["openai"] },
    review: { stencils: ["openai"] },
    payments: { stencils: ["stripe"] },
  },
  steps: [
    runStep(
      "launch-burst",
      "launch-burst",
      {
        title: msg("tutorials.sharedApiQuotas.runTitle"),
        goal: msg("tutorials.sharedApiQuotas.runGoal"),
        done: msg("tutorials.sharedApiQuotas.runDoneV2"),
      },
      true,
    ),
    moment(
      "shared-refusals",
      "answer",
      {
        kind: "all",
        checks: [
          { kind: "metric", subject: "answer", field: "rejected", op: ">=", value: 1 },
          { kind: "metric", subject: "review", field: "rejected", op: ">=", value: 1 },
        ],
      },
      {
        title: msg("tutorials.sharedApiQuotas.sharedTitle"),
        goal: msg("tutorials.sharedApiQuotas.sharedGoal"),
        done: msg("tutorials.sharedApiQuotas.sharedDone"),
      },
    ),
    moment(
      "local-refusals",
      "payments",
      {
        kind: "metric",
        subject: "payments",
        field: "rejected",
        op: ">=",
        value: 1,
      },
      {
        title: msg("tutorials.sharedApiQuotas.localTitle"),
        goal: msg("tutorials.sharedApiQuotas.localGoal"),
        done: msg("tutorials.sharedApiQuotas.localDone"),
      },
    ),
    {
      ...runStep("within-budget", "within-budget", {
        title: msg("tutorials.sharedApiQuotas.smallTitle"),
        goal: msg("tutorials.sharedApiQuotas.smallGoal"),
        done: msg("tutorials.sharedApiQuotas.smallDone"),
      }),
      solution: [{ hover: "live-sim-picker" }, { select: "live-sim-picker", value: "within-budget" }],
    },
    moment(
      "served",
      "answer",
      {
        kind: "all",
        checks: [
          { kind: "processed", subject: "answer", atLeast: 4 },
          { kind: "processed", subject: "review", atLeast: 4 },
          { kind: "processed", subject: "payments", atLeast: 3 },
          { kind: "metric", subject: "answer", field: "rejected", op: "=", value: 0 },
          { kind: "metric", subject: "review", field: "rejected", op: "=", value: 0 },
          { kind: "metric", subject: "payments", field: "rejected", op: "=", value: 0 },
        ],
      },
      {
        title: msg("tutorials.sharedApiQuotas.servedTitle"),
        goal: msg("tutorials.sharedApiQuotas.servedGoal"),
        done: msg("tutorials.sharedApiQuotas.servedDone"),
      },
    ),
  ],
  finish: { text: msg("tutorials.sharedApiQuotas.finishV2") },
};
