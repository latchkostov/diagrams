import { diagnosticLesson } from "./diagnosticLesson";
import { msg } from "../../i18n";
import timetable from "../../examples/cloud-run-timetable-api.json";
import type { DiagramFile } from "../../model/types";
import type { Tutorial } from "../types";
import { moment, runStep } from "./waitingSteps";

const lesson: Tutorial = {
  id: "scale-to-zero",
  version: 3,
  track: "waiting",
  level: 3,
  minutes: 4,
  title: msg("tutorials.scaleToZero.title"),
  summary: msg("tutorials.scaleToZero.summaryV3"),
  start: () => {
    const diagram = structuredClone(timetable) as DiagramFile;
    // Hold the real cold-start readout while the learner reads or switches tabs.
    const rush = diagram.simulations!.find((simulation) => simulation.id === "morning-rush")!;
    const coldStart = rush.timeline!.find((step) => step.atMs === 6000)!;
    if (coldStart.action.do === "note") coldStart.action.pause = true;
    return diagram;
  },
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
        goal: msg("tutorials.scaleToZero.coldGoalV3"),
        done: msg("tutorials.scaleToZero.coldDoneV3"),
      },
    ),
  ],
  finish: { text: msg("tutorials.scaleToZero.finishV3") },
};

export const scaleToZero = diagnosticLesson(lesson, lesson.start as () => DiagramFile);
