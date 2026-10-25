import { msg } from "../i18n";
import type { Tutorial } from "../tutorials/types";

/** Runtime integration preview, separate from the learner catalog. Uses only a public example. */
export const tutorialRuntimeFixtures: readonly Tutorial[] = [
  {
    id: "lab-tutorial-runtime",
    version: 1,
    track: "simulation",
    level: 1,
    minutes: 1,
    chrome: "app",
    title: msg("tutorials.runtime.title"),
    summary: msg("tutorials.runtime.summary"),
    start: { example: "retry-storm", simulation: "three-quick-retries" },
    subjects: { app: { role: "source" }, api: { role: "processor" } },
    steps: [
      {
        id: "running",
        title: msg("tutorials.runtime.runningTitle"),
        goal: msg("tutorials.runtime.runningGoal"),
        check: { kind: "simulation", id: "three-quick-retries", atLeastMs: 250 },
        sticky: true,
        targets: [{ testId: "live-toggle", tip: msg("tutorials.runtime.runningGoal"), dim: false }],
        demo: [],
        solution: [{ hover: "live-toggle" }],
      },
    ],
    finish: { text: msg("tutorials.runtime.finish") },
  },
  {
    id: "lab-tutorial-next",
    version: 1,
    track: "simulation",
    level: 1,
    minutes: 1,
    title: msg("tutorials.runtime.nextTitle"),
    summary: msg("tutorials.runtime.summary"),
    start: { example: "retry-storm" },
    subjects: {},
    steps: [
      {
        id: "live",
        title: msg("tutorials.runtime.runningTitle"),
        goal: msg("tutorials.runtime.runningGoal"),
        check: { kind: "live" },
        targets: [{ testId: "live-toggle", tip: msg("tutorials.runtime.runningGoal") }],
        demo: [{ kind: "live" }],
        solution: [{ click: "live-toggle" }],
      },
    ],
    finish: { text: msg("tutorials.runtime.finish") },
  },
];
