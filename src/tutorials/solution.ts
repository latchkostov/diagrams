import { fillTestId } from "./checks";
import type { RunnerSnapshot } from "./runner";
import type { Tutorial, UiStep } from "./types";
import { inStep } from "./machine";

/** A solution step with its subjects and words filled in: what the generated e2e plays. */
export type ResolvedUiStep =
  | Exclude<UiStep, { fill: string } | { type: unknown }>
  | { fill: string; text: string }
  | { type: string }
  /** Typed at the caret of `into`, which must already have focus. */
  | { type: string; into: string };

const words = (text: string | (() => string)) => (typeof text === "string" ? text : text());

/** The current step's solution path (empty outside a step). */
export function solutionNow(tutorial: Tutorial, snap: RunnerSnapshot): ResolvedUiStep[] {
  if (!inStep(snap.state)) return [];
  const at = (testId: string) => {
    const id = fillTestId(testId, snap.subjects, snap.edges);
    if (id === null) throw new Error(`Tutorial solution names a subject that isn't in the sandbox: ${testId}`);
    return id;
  };
  return tutorial.steps[snap.state.index].solution.map((s): ResolvedUiStep => {
    if ("click" in s) return { click: at(s.click) };
    if ("open" in s) return { open: at(s.open) };
    if ("modClick" in s) return { modClick: at(s.modClick), modifiers: s.modifiers };
    if ("rightclick" in s) return { rightclick: at(s.rightclick) };
    if ("boxSelect" in s) return { boxSelect: at(s.boxSelect), around: s.around.map(at) };
    if ("pane" in s) return s;
    if ("select" in s) return { select: at(s.select), value: s.value };
    if ("dblclick" in s) return { dblclick: at(s.dblclick) };
    if ("hover" in s) return { hover: at(s.hover) };
    if ("fill" in s) return { fill: at(s.fill), text: words(s.text) };
    if ("type" in s) return "text" in s ? { type: words(s.text), into: at(s.type) } : { type: s.type() };
    if ("drag" in s) return { drag: at(s.drag), to: at(s.to) };
    return { press: s.press };
  });
}
