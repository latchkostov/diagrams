import type { Tutorial, UiStep, Words } from "./types";
import type { RunnerSnapshot } from "./runner";
import { fillTestId } from "./checks";
import { inStep } from "./machine";
import { msg } from "../i18n";

/** Missing product equivalents stay explicit; Skip never certifies keyboard completion. */
export const keyboardExceptions: Readonly<Record<string, string>> = {
  boundaries: "Subset selection and membership adoption need product keyboard routes.",
  arrange: "Spatial box selection needs a product keyboard route.",
};

export type KeyboardUiStep =
  | { activate: string }
  | { focus: string }
  | { read: string }
  | { menu: string }
  | { open: string }
  | { write: string; text: string | Words }
  | { choose: string; value: string }
  | { press: string }
  | { type: Words }
  | { type: string; text: string | Words }
  | { connect: string; to: string; side?: string; fromSide?: string }
  | { reconnect: string; to: string }
  | { command: string; query: Words };

function route(step: UiStep, readSection: boolean): KeyboardUiStep[] {
  if ("click" in step) {
    if (step.click === "live-toggle") return [{ command: "live:toggle", query: () => ">" }];
    if (/^(inspector-section-|hover-section-)/.test(step.click)) return [{ open: step.click }];
    if (step.click.startsWith("grow-chip-"))
      return [{ focus: step.click.replace("grow-chip-", "node-") }, { press: "Alt+ArrowRight" }];
    return [{ activate: step.click }];
  }
  if ("open" in step || "press" in step || "type" in step) return [step];
  if ("fill" in step) return [{ write: step.fill, text: step.text }];
  if ("select" in step) return [{ choose: step.select, value: step.value }];
  if ("rightclick" in step) return [{ focus: step.rightclick }, { press: "Shift+F10" }];
  if ("dblclick" in step) return [{ focus: step.dblclick }, { press: "F2" }];
  if ("hover" in step) {
    if (step.hover.startsWith("context-menu-item-")) return [{ menu: step.hover }];
    if (/^(node-|edge-)/.test(step.hover)) return [readSection ? { read: step.hover } : { focus: step.hover }];
    // Timeline/transport hovers only keep the pointer away while traffic runs.
    return /^(node-|edge-|hover-|inspector-|quick-add-)/.test(step.hover) ? [{ focus: step.hover }] : [];
  }
  if ("pane" in step) return [{ press: "ControlOrMeta+k" }];
  if ("drag" in step) {
    const from = /^handle-(.+)-(top|right|bottom|left)$/.exec(step.drag);
    const to = /^handle-(.+)-(top|right|bottom|left)$/.exec(step.to);
    if (from)
      return [{ connect: `node-${from[1]}`, to: to ? `node-${to[1]}` : step.to, side: to?.[2], fromSide: from[2] }];
    const reconnect = /^reconnect-(.+)-target$/.exec(step.drag);
    if (reconnect) return [{ reconnect: `edge-${reconnect[1]}`, to: step.to }];
  }
  throw new Error("This gesture needs an explicit keyboard route");
}

/** Ordinary controls share equivalents; each registered lesson retains the generated variant beside its pointer path. */
export function withKeyboardSolutions(tutorial: Tutorial): Tutorial {
  if (keyboardExceptions[tutorial.id]) return tutorial;
  for (const step of tutorial.steps) {
    const readSection = step.solution.some((action) => "click" in action && action.click.startsWith("hover-section-"));
    const solution: KeyboardUiStep[] = [];
    for (let i = 0; i < step.solution.length; i++) {
      const action = step.solution[i];
      // The final replay observation requires no navigation; moving focus can pause the take being watched.
      if ("hover" in action && step.check.kind === "slowmo" && step.check.finished) continue;
      if ("rightclick" in action && action.rightclick === "canvas-pane") {
        const leaf = step.solution[i + 2];
        if (leaf && "click" in leaf && leaf.click === "context-menu-item-view:dependencies") {
          solution.push({ command: "action:view:dependencies", query: msg("menu.dependencies") });
          i += 2;
          continue;
        }
      }
      const routed = route(action, readSection);
      // Canvas quick-add becomes Ctrl+K's stencil search.
      if ("pane" in action) {
        const fill = step.solution[++i];
        if (!fill || !("fill" in fill)) throw new Error("Quick-add needs a stencil query");
        solution.push(...routed, { write: "command-input", text: fill.text });
      } else solution.push(...routed);
    }
    step.keyboardSolution = solution;
  }
  return tutorial;
}

export type ResolvedKeyboardStep =
  | Exclude<KeyboardUiStep, { write: string } | { type: unknown } | { command: string }>
  | { write: string; text: string }
  | { type: string; into?: string }
  | { command: string; query: string };

/** Read-only test seam: keyboard events still have to satisfy the unchanged completion checks. */
export function keyboardSolutionNow(tutorial: Tutorial, snap: RunnerSnapshot): ResolvedKeyboardStep[] {
  if (!inStep(snap.state)) return [];
  const at = (id: string) => {
    const filled = fillTestId(id, snap.subjects, snap.edges);
    if (filled === null) throw new Error(`Missing keyboard solution subject: ${id}`);
    return filled;
  };
  const words = (value: string | Words) => (typeof value === "string" ? value : value());
  return (tutorial.steps[snap.state.index].keyboardSolution ?? []).map((step): ResolvedKeyboardStep => {
    if ("activate" in step) return { activate: at(step.activate) };
    if ("focus" in step) return { focus: at(step.focus) };
    if ("read" in step) return { read: at(step.read) };
    if ("menu" in step) return { menu: at(step.menu) };
    if ("open" in step) return { open: at(step.open) };
    if ("write" in step) return { write: at(step.write), text: words(step.text) };
    if ("choose" in step) return { choose: at(step.choose), value: step.value };
    if ("connect" in step)
      return { connect: at(step.connect), to: at(step.to), side: step.side, fromSide: step.fromSide };
    if ("reconnect" in step) return { reconnect: at(step.reconnect), to: at(step.to) };
    if ("command" in step) return { command: at(step.command), query: step.query() };
    if ("type" in step) return "text" in step ? { type: words(step.text), into: at(step.type) } : { type: step.type() };
    return step;
  });
}
