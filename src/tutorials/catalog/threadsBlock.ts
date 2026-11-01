import { diagnosticLesson } from "./diagnosticLesson";
import reference from "../../examples/blocking-call.json";
import type { DiagramFile } from "../../model/types";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { liveStep, moment, patchStep, runStep } from "./waitingSteps";

const lesson: Tutorial = {
  id: "threads-block",
  version: 3,
  track: "waiting",
  level: 2,
  minutes: 4,
  title: msg("tutorials.threadsBlock.title"),
  summary: msg("tutorials.threadsBlock.summaryV3"),
  start: { example: "blocking-call" },
  subjects: { caller: { stencils: ["generic.service"] }, partner: { stencils: ["generic.external-api"] } },
  steps: [
    runStep(
      "run-blocking",
      "blocking",
      {
        title: msg("tutorials.threadsBlock.runTitle"),
        goal: msg("tutorials.threadsBlock.runGoal"),
        done: msg("tutorials.threadsBlock.runDone"),
      },
      true,
    ),
    // Seed 17: 56 waiting threads at 2 s; >= 1 keeps well over 30% margin.
    moment(
      "threads-waiting",
      "caller",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "blocking" },
          { kind: "compare", left: { node: "caller", metric: "threads.waiting" }, op: ">=", right: 1 },
        ],
      },
      {
        title: msg("tutorials.threadsBlock.waitTitle"),
        goal: msg("tutorials.threadsBlock.waitGoal"),
        done: msg("tutorials.threadsBlock.waitDone"),
      },
    ),
    patchStep(
      "free-thread",
      { edge: ["caller", "partner"] },
      [{ op: "set", path: ["caller", "wait"], value: "non-blocking" }],
      { kind: "prop", edge: ["caller", "partner"], prop: ["caller", "wait"], op: "=", value: "non-blocking" },
      "context-menu-item-edge.wait",
      [
        { click: "live-toggle" },
        { rightclick: "edge-{caller->partner}" },
        { click: "context-menu-item-edge.simulation" },
        { click: "context-menu-item-edge.wait" },
      ],
      {
        title: msg("tutorials.threadsBlock.freeTitle"),
        goal: msg("tutorials.threadsBlock.freeGoalV3"),
        done: msg("tutorials.threadsBlock.freeDoneV3"),
      },
    ),
    liveStep("live-run-free-thread", {
      kind: "prop",
      edge: ["caller", "partner"],
      prop: ["caller", "wait"],
      op: "=",
      value: "non-blocking",
    }),
    runStep(
      "run-free-thread",
      "free-thread",
      {
        title: msg("tutorials.threadsBlock.rerunTitle"),
        goal: msg("tutorials.threadsBlock.rerunGoalV3"),
        done: msg("tutorials.threadsBlock.rerunDone"),
      },
      false,
    ),
    moment(
      "no-threads-waiting",
      "caller",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "free-thread", atLeastMs: 2000 },
          { kind: "compare", left: { node: "caller", metric: "threads.waiting" }, op: "=", right: 0 },
          // Seed 17: 588 completions at 2 s; 400 leaves >30% margin and excludes an empty run.
          { kind: "compare", left: { node: "caller", metric: "processed" }, op: ">=", right: 400 },
        ],
      },
      {
        title: msg("tutorials.threadsBlock.resultTitle"),
        goal: msg("tutorials.threadsBlock.resultGoal"),
        done: msg("tutorials.threadsBlock.resultDoneV3"),
      },
    ),
  ],
  finish: { text: msg("tutorials.threadsBlock.finishV3") },
};

export const threadsBlock = diagnosticLesson(lesson, () => structuredClone(reference) as DiagramFile);
