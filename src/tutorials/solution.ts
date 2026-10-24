import { fillTestId } from "./checks";
import type { RunnerSnapshot } from "./runner";
import type { Tutorial } from "./types";

/** A solution step with its subjects and words filled in: what the generated e2e plays. */
export type ResolvedUiStep =
  | { click: string }
  | { dblclick: string }
  | { hover: string }
  | { fill: string; text: string }
  | { press: string }
  | { drag: string; to: string };

const fill = (testId: string, subjects: RunnerSnapshot["subjects"]) => {
  const id = fillTestId(testId, subjects);
  if (id === null) throw new Error(`Tutorial solution names a subject that isn't in the sandbox: ${testId}`);
  return id;
};

/** The current step's solution path (empty outside a step). */
export function solutionNow(tutorial: Tutorial, snap: RunnerSnapshot): ResolvedUiStep[] {
  if (snap.state.value !== "step") return [];
  const { subjects } = snap;
  return tutorial.steps[snap.state.index].solution.map((s): ResolvedUiStep => {
    if ("click" in s) return { click: fill(s.click, subjects) };
    if ("dblclick" in s) return { dblclick: fill(s.dblclick, subjects) };
    if ("hover" in s) return { hover: fill(s.hover, subjects) };
    if ("fill" in s) return { fill: fill(s.fill, subjects), text: typeof s.text === "string" ? s.text : s.text() };
    if ("drag" in s) return { drag: fill(s.drag, subjects), to: fill(s.to, subjects) };
    return { press: s.press };
  });
}
