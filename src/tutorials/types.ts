import type { DiagramFile, SimRole } from "../model/types";

/**
 * The tutorial format: typed data, no code. A tutorial is a starting diagram plus steps; each step says what to do
 * (goal), how the runner knows it's done (check), where to point (targets), how to do it for you (demo) and the UI
 * path a test plays (solution). Words are catalog messages (`msg("tutorials.…")`), so they translate like the app.
 *
 * Names in braces inside a test id (`grow-chip-{app}`) are subjects: nodes found in the sandbox by what they are
 * (`subjects`), never by a fixed id, so a learner's own way of adding a node counts as much as the expected one.
 */

/** A catalog message, translated when shown. */
export type Words = () => string;

export type TrackId = "basics" | "blocks" | "simulation" | "waiting" | "resilience" | "studies";

/** How a subject is found: an unbound node (in diagram order) with one of these stencils, else of this role. */
export interface SubjectSpec {
  stencils?: readonly string[];
  role?: SimRole;
}

/** What makes a step done. Plain data, so tests and the authoring lint can read it. */
export type Check =
  | { kind: "node"; subject: string }
  /** A flow (never a dependency) from one subject to the other. */
  | { kind: "edge"; from: string; to: string }
  /**
   * expectText: the subject's label is this, ignoring case and outer spaces. A name of the learner's own that isn't it
   * is a near miss (checks.ts, nearMiss): the strip says what's expected and offers it in one click.
   */
  | { kind: "label"; subject: string; is: Words }
  | { kind: "live" }
  /** Live counters (real messages) since the run started. */
  | { kind: "processed"; subject: string; atLeast: number }
  | { kind: "all"; checks: readonly Check[] };

/** Done for you ("Skip step"), through the editor API: one undo step each, as if the learner did it. */
export type Demo =
  | { kind: "add"; subject: string; stencil: string; after?: string }
  | { kind: "connect"; from: string; to: string }
  | { kind: "rename"; subject: string; label: Words }
  | { kind: "live" };

/** One action of the solution path, by test id only. The generated e2e plays these through the real UI. */
export type UiStep =
  | { click: string }
  | { dblclick: string }
  | { hover: string }
  | { fill: string; text: string | Words }
  | { press: string }
  | { drag: string; to: string };

/** Where to point: the first visible match wins, so a step can say "the +, else the node". */
export interface Target {
  testId: string;
  /** The coach mark's words beside it. */
  tip: Words;
  /** Only while this subject is the one selected. */
  selected?: string;
  /** false: ring it without dimming the rest (a step about watching the whole canvas). */
  dim?: false;
}

export interface TutorialStep {
  id: string;
  /** A few words: the step list and the screen reader's announcement. */
  title: Words;
  /** What to do, in a sentence or two. */
  goal: Words;
  /** Shown by "Show me", with the highlight forced on. */
  hint?: Words;
  /** Said once it's done (or done for you): the lesson of the step. */
  done?: Words;
  check: Check;
  /** Once met, stays met: a moment rather than a state (traffic seen). Steps without a demo are sticky too. */
  sticky?: boolean;
  /**
   * "naming": the step is done when its check holds and the learner has finished naming (Enter, Esc or leaving the
   * field), as the editor's mode says; until then it's `completing`. A name is never judged half typed.
   */
  settle?: "naming";
  /** What the canvas is guided to while this step is current: quick-add opens searched for this (its pick). */
  guide?: { quickAdd?: Words };
  targets: readonly Target[];
  demo: readonly Demo[];
  solution: readonly UiStep[];
}

export interface Tutorial {
  id: string;
  /** Bumped when steps change meaning: saved progress for another version starts over. */
  version: number;
  track: TrackId;
  level: 1 | 2 | 3;
  minutes: number;
  title: Words;
  summary: Words;
  /** The sandbox's first diagram. A function: its title is translated when it opens. */
  start(): DiagramFile;
  subjects: Readonly<Record<string, SubjectSpec>>;
  steps: readonly TutorialStep[];
  finish: { text: Words; example?: { slug: string; label: Words } };
}
