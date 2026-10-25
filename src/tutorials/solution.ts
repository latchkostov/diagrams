import { fillTestId } from "./checks";
import type { RunnerSnapshot } from "./runner";
import type { Tutorial, UiStep } from "./types";
import { inStep } from "./machine";

/** A solution step with its subjects and words filled in: what the generated e2e plays. */
export type ResolvedUiStep =
  Exclude<UiStep, { fill: string } | { type: unknown }> | { fill: string; text: string } | { type: string };

const fill = (testId: string, subjects: RunnerSnapshot["subjects"]) => {
  const id = fillTestId(testId, subjects);
  if (id === null) throw new Error(`Tutorial solution names a subject that isn't in the sandbox: ${testId}`);
  return id;
};

/** The current step's solution path (empty outside a step). */
export function solutionNow(tutorial: Tutorial, snap: RunnerSnapshot): ResolvedUiStep[] {
  if (!inStep(snap.state)) return [];
  const { subjects } = snap;
  return tutorial.steps[snap.state.index].solution.map((s): ResolvedUiStep => {
    if ("click" in s) return { click: fill(s.click, subjects) };
    if ("modClick" in s) return { modClick: fill(s.modClick, subjects), modifiers: s.modifiers };
    if ("rightclick" in s) return { rightclick: fill(s.rightclick, subjects) };
    if ("boxSelect" in s)
      return { boxSelect: fill(s.boxSelect, subjects), around: s.around.map((id) => fill(id, subjects)) };
    if ("pane" in s) return s;
    if ("select" in s) return { select: fill(s.select, subjects), value: s.value };
    if ("dblclick" in s) return { dblclick: fill(s.dblclick, subjects) };
    if ("hover" in s) return { hover: fill(s.hover, subjects) };
    if ("fill" in s) return { fill: fill(s.fill, subjects), text: typeof s.text === "string" ? s.text : s.text() };
    if ("type" in s) return { type: s.type() };
    if ("drag" in s) return { drag: fill(s.drag, subjects), to: fill(s.to, subjects) };
    return { press: s.press };
  });
}
