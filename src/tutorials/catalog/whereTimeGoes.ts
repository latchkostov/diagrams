import { diagnosticLesson } from "./diagnosticLesson";
import referenceText from "../../examples/where-the-time-goes.json?raw";
import type { DiagramFile } from "../../model/types";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { moment, runStep } from "./waitingSteps";

// Keep the public example’s independently retryable download out of the tutorial module graph.
const reference = JSON.parse(referenceText) as DiagramFile;

const lesson: Tutorial = {
  id: "where-time-goes",
  version: 3,
  track: "waiting",
  level: 2,
  minutes: 4,
  title: msg("tutorials.whereTimeGoes.title"),
  summary: msg("tutorials.whereTimeGoes.summaryV3"),
  start: { example: "where-the-time-goes" },
  subjects: { billing: { stencils: ["service.dotnet"] } },
  steps: [
    {
      id: "predict",
      title: msg("tutorials.whereTimeGoes.predictTitleV3"),
      goal: msg("tutorials.whereTimeGoes.predictGoalV3"),
      done: msg("tutorials.whereTimeGoes.predictDoneV3"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{billing}", tip: msg("tutorials.whereTimeGoes.predictTitleV3") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
    runStep(
      "run",
      "slow-billing-drill",
      {
        title: msg("tutorials.whereTimeGoes.runTitle"),
        goal: msg("tutorials.whereTimeGoes.runGoalV3"),
        done: msg("tutorials.whereTimeGoes.runDoneV3"),
      },
      true,
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "slow-billing-drill", atLeastMs: 9000 },
          { kind: "note", waiting: true },
        ],
      },
    ),
    moment(
      "read-p95",
      "billing",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "slow-billing-drill" },
          // Seed 41: p95 = 1,500 ms at 5 s; 1,050 ms leaves a 30% margin.
          { kind: "compare", left: { node: "billing", metric: "latency.p95" }, op: ">=", right: 1050 },
        ],
      },
      {
        title: msg("tutorials.whereTimeGoes.p95Title"),
        goal: msg("tutorials.whereTimeGoes.p95GoalV3"),
        done: msg("tutorials.whereTimeGoes.p95DoneV3"),
      },
    ),
    moment(
      "waiting-vs-working",
      "billing",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "slow-billing-drill" },
          // Seed 41 at 9 s: wait 32,056.5 ms > work 23,334 ms (37% above work).
          {
            kind: "compare",
            left: { node: "billing", metric: "latency.waitMs" },
            op: ">",
            right: { node: "billing", metric: "latency.workMs" },
          },
        ],
      },
      {
        title: msg("tutorials.whereTimeGoes.compareTitle"),
        goal: msg("tutorials.whereTimeGoes.compareGoal"),
        done: msg("tutorials.whereTimeGoes.compareDone"),
      },
    ),
    {
      id: "read-breakdown",
      title: msg("tutorials.whereTimeGoes.breakdownTitle"),
      goal: msg("tutorials.whereTimeGoes.breakdownGoalV3"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "hover-section-latency", tip: msg("tutorials.whereTimeGoes.breakdownGoalV3"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{billing}" }, { click: "hover-section-latency" }, { click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.whereTimeGoes.finishV3") },
};

export const whereTimeGoes = diagnosticLesson(lesson, () => {
  const diagram = structuredClone(reference) as DiagramFile;
  const run = diagram.simulations!.find((run) => run.id === "slow-billing-drill")!;
  run.timeline = [
    ...(run.timeline ?? []),
    {
      atMs: 9000,
      action: { do: "note", text: msg("tutorials.whereTimeGoes.compareGoal")(), focus: ["billing"], pause: true },
    },
  ];
  return diagram;
});
