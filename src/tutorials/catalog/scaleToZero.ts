import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { moment, runStep } from "./waitingSteps";

export const scaleToZero: Tutorial = {
  id: "scale-to-zero",
  version: 2,
  track: "waiting",
  level: 3,
  minutes: 4,
  title: msg("tutorials.scaleToZero.title"),
  summary: msg("tutorials.scaleToZero.summary"),
  start: { example: "cloud-run-timetable-api" },
  subjects: { worker: { stencils: ["gcp.cloud-run"] } },
  steps: [
    runStep(
      "run-quiet-sunday",
      "quiet-sunday",
      {
        title: msg("tutorials.scaleToZero.runTitle"),
        goal: msg("tutorials.scaleToZero.runGoal"),
        done: msg("tutorials.scaleToZero.runDone"),
      },
      true,
    ),
    // Seed 29 starts with zero replicas; zero is an exact state, not a noisy threshold.
    moment(
      "replicas-zero",
      "worker",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "quiet-sunday" },
          { kind: "compare", left: { node: "worker", metric: "replicas" }, op: "=", right: 0 },
        ],
      },
      {
        title: msg("tutorials.scaleToZero.zeroTitle"),
        goal: msg("tutorials.scaleToZero.zeroGoal"),
        done: msg("tutorials.scaleToZero.zeroDone"),
      },
    ),
    runStep("run-morning-rush", "morning-rush", {
      title: msg("tutorials.scaleToZero.rushTitle"),
      goal: msg("tutorials.scaleToZero.rushGoal"),
      done: msg("tutorials.scaleToZero.rushDone"),
    }),
    moment(
      "cold-start",
      "worker",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "morning-rush" },
          { kind: "compare", left: { node: "worker", metric: "fleet.starting" }, op: ">=", right: 1 },
        ],
      },
      {
        title: msg("tutorials.scaleToZero.coldTitle"),
        goal: msg("tutorials.scaleToZero.coldGoal"),
        done: msg("tutorials.scaleToZero.coldDone"),
      },
    ),
  ],
  finish: { text: msg("tutorials.scaleToZero.finish") },
};
