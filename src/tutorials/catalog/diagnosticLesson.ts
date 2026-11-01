import { msg } from "../../i18n";
import type { DiagramFile } from "../../model/types";
import type { Check, Demo, Tutorial } from "../types";

/** Content-only recovery: restore the authored experiment through Save/Run, never by writing engine state. */
export function diagnosticLesson(lesson: Tutorial, initial: () => DiagramFile): Tutorial {
  const reference = initial();
  const simulation = (id: string) => reference.simulations?.find((s) => s.id === id);
  const check = (c: Check): Check => {
    if (c.kind === "all") return { ...c, checks: c.checks.map(check) };
    if (c.kind === "simulation" && c.id) {
      const s = simulation(c.id);
      if (!s) throw new Error(`Missing tutorial simulation: ${c.id}`);
      return {
        kind: "simulation",
        atLeastMs: c.atLeastMs,
        traffic: c.traffic,
        saved: {
          id: s.id,
          seed: s.seed,
          scale: s.scale ?? 1,
          durationMs: s.durationMs,
          traffic: s.traffic,
          notes: s.timeline?.flatMap((step) =>
            step.action.do === "note" && step.action.pause && step.action.focus?.[0]
              ? [{ atMs: step.atMs, pause: true, focus: step.action.focus[0] }]
              : [],
          ),
          multipliers: { traffic: s.multipliers?.traffic ?? 1, capacity: s.multipliers?.capacity ?? 1 },
        },
      };
    }
    if (c.kind === "expectation" && c.label) {
      const label = typeof c.label === "function" ? c.label() : c.label;
      const e = simulation(c.simulation)?.expectations?.find((e) => e.id === label || e.label === label);
      if (!e) throw new Error(`Missing tutorial expectation: ${label}`);
      return {
        kind: "expectation",
        simulation: c.simulation,
        outcome: c.outcome,
        match: { metric: e.metric, op: e.op, value: e.value, when: e.when, atMs: e.atMs },
      };
    }
    return c;
  };
  const prepare = (actions: readonly Demo[]): Demo[] =>
    actions.flatMap<Demo>((d) => {
      if (d.kind !== "runSimulation") return [d];
      const definition = simulation(d.id);
      if (!definition) throw new Error(`Missing tutorial simulation: ${d.id}`);
      return [{ kind: "saveSimulation", id: d.id, title: () => definition.title, definition }, d];
    });
  return {
    ...lesson,
    start: initial,
    steps: lesson.steps.map((step) => {
      const keyboard = msg("tutorials.diagnostics.keyboardRoute");
      const targets = step.targets.map((target) => ({ ...target, tip: step.title }));
      return {
        ...step,
        targets,
        check: check(step.check),
        demo: prepare(step.demo),
        ...(step.reconstruct ? { reconstruct: prepare(step.reconstruct) } : {}),
        coach: step.coach ?? {
          routes: [
            { kind: "pointer", summary: step.goal, targets },
            { kind: "keyboard", summary: () => `${step.goal()} ${keyboard()}`, targets },
          ],
        },
      };
    }),
  };
}
