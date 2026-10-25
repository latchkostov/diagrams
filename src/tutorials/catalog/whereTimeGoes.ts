import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { moment, runStep } from "./waitingSteps";

export const whereTimeGoes: Tutorial = {
  id: "where-time-goes",
  version: 1,
  track: "waiting",
  level: 2,
  minutes: 4,
  title: msg("tutorials.whereTimeGoes.title"),
  summary: msg("tutorials.whereTimeGoes.summary"),
  start: { example: "where-the-time-goes" },
  subjects: { billing: { stencils: ["service.dotnet"] } },
  steps: [
    runStep(
      "run",
      "slow-billing-drill",
      {
        title: msg("tutorials.whereTimeGoes.runTitle"),
        goal: msg("tutorials.whereTimeGoes.runGoal"),
        done: msg("tutorials.whereTimeGoes.runDone"),
      },
      true,
    ),
    moment(
      "read-p95",
      "billing",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "slow-billing-drill" },
          { kind: "readout", subject: "billing" },
          // Seed 41: p95 = 1,500 ms at 5 s; 1,050 ms leaves a 30% margin.
          { kind: "compare", left: { node: "billing", metric: "latency.p95" }, op: ">=", right: 1050 },
        ],
      },
      {
        title: msg("tutorials.whereTimeGoes.p95Title"),
        goal: msg("tutorials.whereTimeGoes.p95Goal"),
        done: msg("tutorials.whereTimeGoes.p95Done"),
      },
    ),
    moment(
      "waiting-vs-working",
      "billing",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "slow-billing-drill" },
          { kind: "readout", subject: "billing" },
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
  ],
  finish: { text: msg("tutorials.whereTimeGoes.finish") },
};
