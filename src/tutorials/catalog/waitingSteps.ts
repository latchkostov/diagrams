import { msg } from "../../i18n";
import type { Check, PropPatch, PropertyTarget, TutorialStep, UiStep, Words } from "../types";

type Copy = { title: Words; goal: Words; done: Words };

/**
 * Manual edits, Skip and Continue share one rerun path. Latch after this edit so leaving Live for a later edit
 * cannot reopen an earlier entry, and an earlier run cannot satisfy a future entry before its property is set.
 */
export function liveStep(id: string, after: Check): TutorialStep {
  return {
    id,
    title: msg("tutorials.mobileApi.liveTitle"),
    goal: msg("tutorials.mobileApi.liveGoal"),
    check: { kind: "all", checks: [after, { kind: "live" }] },
    sticky: true,
    targets: [{ testId: "live-toggle", tip: msg("tutorials.mobileApi.liveTip") }],
    demo: [{ kind: "live" }],
    solution: [{ click: "live-toggle" }],
  };
}

/** Saved runs latch: the next comparison deliberately replaces this run. */
export function runStep(id: string, simulation: string, copy: Copy, enterLive = false, watch?: Check): TutorialStep {
  return {
    id,
    ...copy,
    check: watch
      ? { kind: "all", checks: [{ kind: "simulation", id: simulation }, watch] }
      : { kind: "simulation", id: simulation },
    sticky: true,
    targets: [
      { testId: "live-sim-picker", tip: copy.goal },
      { testId: "live-toggle", tip: copy.goal },
    ],
    demo: [{ kind: "runSimulation", id: simulation }],
    solution: [...(enterLive ? [{ click: "live-toggle" }] : []), { select: "live-sim-picker", value: simulation }],
  };
}

export function moment(id: string, subject: string, check: Check, copy: Copy): TutorialStep {
  return {
    id,
    ...copy,
    check: { kind: "all", checks: [{ kind: "readout", subject }, check] },
    sticky: true,
    targets: [{ testId: `node-{${subject}}`, tip: copy.goal, dim: false }],
    demo: [],
    solution: [{ hover: `node-{${subject}}` }],
  };
}

export function patchStep(
  id: string,
  target: PropertyTarget,
  patches: readonly PropPatch[],
  check: Check,
  field: string,
  solution: readonly UiStep[],
  copy: Copy,
): TutorialStep {
  const testId = target.edge ? `edge-{${target.edge[0]}->${target.edge[1]}}` : `node-{${target.subject}}`;
  return {
    id,
    ...copy,
    check,
    targets: [
      { testId: field, tip: copy.goal },
      { testId, tip: copy.goal },
    ],
    demo: [{ kind: "patch", ...target, patches }],
    solution,
  };
}
