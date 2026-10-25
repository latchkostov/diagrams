import type { Simulation } from "../../model/types";
import type { TutorialStep, Words } from "../types";

/** A saved seed for the source rates the learner turns on with Continuous traffic. */
export const practiceRun = (title: Words): Simulation => ({
  id: "tutorial-flow",
  title: title(),
  seed: 20261024,
  scale: 1,
  durationMs: 600_000,
  traffic: [],
});

export function connectedStep(opts: {
  id: string;
  from: string;
  subject: string;
  stencil: string;
  search: Words;
  title: Words;
  goal: Words;
  done: Words;
  hint: Words;
  name?: Words;
}): TutorialStep {
  const { id, from, subject, stencil, search, title, goal, done, hint, name } = opts;
  return {
    id,
    title,
    goal,
    done,
    hint,
    check: {
      kind: "all",
      checks: [{ kind: "edge", from, to: subject }, ...(name ? [{ kind: "label" as const, subject, is: name }] : [])],
    },
    ...(name ? { settle: "naming" as const } : {}),
    guide: { quickAdd: search },
    targets: [
      ...(name ? [{ testId: "inspector-field-label", tip: goal, selected: subject }] : []),
      { testId: `context-menu-item-quick-add:recent:${stencil}`, tip: goal },
      { testId: `context-menu-item-quick-add:${stencil}`, tip: goal },
      { testId: `grow-chip-{${from}}`, tip: goal, selected: from },
      { testId: `node-{${from}}`, tip: goal },
    ],
    demo: [
      { kind: "add", subject, stencil, after: from },
      ...(name ? [{ kind: "rename" as const, subject, label: name }] : []),
    ],
    solution: [
      { click: `node-{${from}}` },
      { click: "fit-view-button" },
      { click: `grow-chip-{${from}}` },
      // Wait on the rendered quick-add before pressing its highlighted choice.
      { hover: "quick-add-search" },
      // Enter picks the guided first match, including its Recent variant.
      { press: "Enter" },
      ...(name ? [{ fill: "inspector-field-label", text: name }, { press: "Enter" }] : [{ press: "Enter" }]),
    ],
  };
}

export function liveStep(title: Words, goal: Words, done: Words): TutorialStep {
  return {
    id: "live",
    title,
    goal,
    done,
    check: { kind: "simulation", id: "tutorial-flow", traffic: true },
    targets: [
      { testId: "live-traffic", tip: goal },
      { testId: "live-controls", tip: goal, dim: false },
      { testId: "live-toggle", tip: goal },
    ],
    demo: [
      { kind: "runSimulation", id: "tutorial-flow" },
      { kind: "traffic", on: true },
    ],
    solution: [
      { click: "live-toggle" },
      { select: "live-sim-picker", value: "tutorial-flow" },
      { click: "live-more" },
      { click: "live-traffic" },
      { click: "live-more" },
    ],
  };
}
