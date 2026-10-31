import type { AnnotationKind, DiagramFile, EdgeRelation, Expectation, Side, SimRole } from "../model/types";
import type { EdgeSimState, NodeSimState } from "../sim/types";
import type { EditorModeValue } from "../canvas/interaction/mode";
import type { DrillPreset } from "../model/faults";
import type { ProductObservations } from "../lib/observations";
import type { KeyboardUiStep } from "./keyboard";

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

export type { TrackId } from "./chapters";
import type { TrackId } from "./chapters";

/** How a subject is found: an unbound node (in diagram order) with one of these stencils, else of this role. */
export interface SubjectSpec {
  /** An edge initially found between these node subjects; keeps its identity through reconnects. */
  edge?: readonly [string, string];
  /** `true`: an unbound boundary in diagram order. `members`: the boundary holding all these node subjects. */
  boundary?: true | { members: readonly [string, ...string[]] };
  stencils?: readonly string[];
  role?: SimRole;
  /** Require an incoming flow from this earlier-declared node subject. */
  downstreamOf?: string;
  /**
   * A node on the flow between these earlier-declared subjects: an incoming flow from the first or an outgoing flow
   * to the second. Either connection keeps it bound, so a learner rewiring one end can still be repaired.
   */
  between?: readonly [string, string];
}

export type Comparison = "=" | ">=" | "<=";
export type PropertyTarget = { subject: string; edge?: never } | { edge: readonly [string, string]; subject?: never };
export type FaultKind = "down" | "slow" | "fail" | "cut";

/** A value a path matches or a patch writes: JSON, or a catalog message (a setting key in the learner's language). */
export type PathLiteral = string | number | boolean | null | Words;
export type PatchValue = PathLiteral | readonly PatchValue[] | { readonly [key: string]: PatchValue };
/**
 * One step into props: an own object key, a whole-number array index, or `where`: the first array item whose fields
 * equal these. Never the prototype: `constructor`, `__proto__` or an array's `length` aren't keys (the lint says so).
 */
export type PathSegment = string | number | { where: Readonly<Record<string, PathLiteral>> };
/** A path into a node's or edge's props (src/tutorials/paths.ts), from a top-level key: `["settings", 4, "secret"]`. */
export type PropPath = readonly [string, ...PathSegment[]];
/** `measure: "length"` compares the length of the list at the path (missing, or not a list: the check fails). */
type PropComparison =
  | { op: Comparison; value: unknown; measure?: never }
  | { measure: "length"; op: Comparison; value: number }
  /** Whether an optional configuration is enabled, including customized objects. */
  | { op: "truthy"; value?: never; measure?: never }
  | { op: "falsy"; value?: never; measure?: never };

/**
 * An edit-preserving prop edit for a demo: idempotent, and it writes only what's missing, so the learner's other values
 * stay theirs (a fifth setting is appended; the four they have are kept as they are).
 */
export type PropPatch =
  /** This value at the path, creating missing object keys; a missing list item or a non-object on the way skips it. */
  | { op: "set"; path: PropPath; value: PatchValue }
  /** Like set, only while nothing is at the path. */
  | { op: "setIfMissing"; path: PropPath; value: PatchValue }
  /** The list at the path (made if missing) has an item matching `match`; else `{ ...match, ...with }` is appended. */
  | {
      op: "ensureItem";
      path: PropPath;
      match: Readonly<Record<string, PathLiteral>>;
      with?: Readonly<Record<string, PatchValue>>;
    }
  /** A number at the path below this one is raised to it; nothing, null (none) or a larger number stays. */
  | { op: "atLeast"; path: PropPath; value: number };

/**
 * A saved run a repair also fixes (src/tutorials/repair.ts): by id, or whichever run Live has selected (none in free
 * play, or while Live is off). An unsaved draft of that run is repaired in place, the saved run otherwise.
 */
export type RunRef = string | { selected: true };

type NumericKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never }[keyof T];
/**
 * A node's Live number: any numeric field of its metrics; its latency (percentiles, and the time spent waiting or
 * working); its threads; its fleet (replicas desired, ready, still starting: a cold start).
 */
export type NodeMetric =
  | NumericKeys<NodeSimState>
  | `latency.${"p50" | "p95" | "p99" | "waitMs" | "workMs"}`
  | `threads.${"working" | "waiting" | "queued"}`
  | `fleet.${"desired" | "ready" | "starting" | "draining"}`;
export type EdgeMetric = NumericKeys<EdgeSimState>;
/**
 * Every node a subject spec would fit (stencils, else role), bound or not: "every worker". within: only those in this
 * boundary subject ("every service in cell A").
 */
export type NodeMatch = Pick<SubjectSpec, "stencils" | "role"> & { within?: string };
/** A Live number, read from the session's real-unit snapshot. A missing reading (or an empty set) fails the check. */
export type MetricValue =
  | { node: string; metric: NodeMetric }
  | { edge: readonly [string, string]; metric: EdgeMetric }
  | { sum: NodeMetric; nodes: readonly string[] }
  | { sum: NodeMetric; every: NodeMatch }
  | { sum: EdgeMetric; edges: readonly (readonly [string, string])[] }
  /** Every flow out of this subject. */
  | { sum: EdgeMetric; from: string }
  /** A property number; effective opts into Live configuration, including capacity multipliers. */
  | ({ prop: string | PropPath; effective?: true } & PropertyTarget);
/**
 * `sinceStep`: counted since this step became current. Its baseline is read on entry and kept in the runner's state
 * (RunnerState.baseline); a rebuilt run (a new generation) counts from zero. Only sticky steps may use it.
 */
export type MetricExpr = MetricValue | { sinceStep: MetricValue };
export type MetricComparison = Comparison | "<" | ">";

/** A saved simulation by what it is: its id, a Drill step (one fault preset, or any), at least this many expectations. */
export interface SimulationMatch {
  id?: string;
  drill?: DrillPreset | "any";
  expectations?: number;
}
/** A Live panel or view, as Live publishes it (src/live/planningHost.ts, src/live/capacityOverlay.ts). */
export type LiveView = "inputs" | "events" | "simulations" | "capacity";
/** Live's what-if inputs (the Inputs panel): Traffic ×, Capacity ×, Scale. */
export type LiveInput = "traffic" | "capacity" | "scale";

/** What makes a step done. Plain data, so tests and the authoring lint can read it. */
export type Check =
  | { kind: "dock"; tab: ProductObservations["dock"]["tab"]; snap?: ProductObservations["dock"]["snap"] }
  | {
      kind: "checks";
      status: ProductObservations["checks"]["status"];
      rule?: string;
      absent?: true;
      findings?: number;
      simulation?: string;
    }
  | { kind: "routeEvidence"; subject: string; route: string; rule?: string; to?: string; rejected?: true }
  | { kind: "view"; view: NonNullable<ProductObservations["dock"]["view"]> }
  | { kind: "export"; format: ProductObservations["exports"]["format"] }
  | { kind: "import"; format: ProductObservations["imports"]["format"] }
  | { kind: "aiTurn"; turn?: ProductObservations["ai"]["kind"]; subject?: string }
  | { kind: "collaboration"; status: "joined" | "left"; role?: ProductObservations["collaboration"]["role"] }
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
  | { kind: "field"; subject: string; field: "sublabel" | "description"; is?: Words }
  /** A prop or path (`["settings", 4, "secret"]`); effective uses Live configuration; measure compares a list's length. */
  | ({ kind: "prop"; prop: string | PropPath; effective?: true } & PropComparison & PropertyTarget)
  /** Two Live numbers, or one and a constant: sums over subjects, a delta since the step began. */
  | { kind: "compare"; left: MetricExpr; op: MetricComparison; right: MetricExpr | number }
  // edgeKind / annotation / fault distinguish the payload from the check's discriminant.
  | { kind: "relation"; from: string; to: string; relation?: EdgeRelation; edgeKind?: "sync" | "async"; absent?: true }
  | { kind: "member"; subject: string; boundary: string }
  | { kind: "annotation"; annotation: AnnotationKind; count?: number }
  | {
      kind: "metric";
      subject: string;
      field: NodeMetric | keyof NodeSimState | "breaker";
      op: Comparison;
      value: number | string | boolean;
      edge?: readonly [string, string];
    }
  /**
   * A saved simulation is running: this one (id), or one the learner authored that matches (saved). traffic:
   * Continuous traffic is on (true) or off (false) in that run, as Live's control shows it.
   */
  | ({ kind: "simulation"; atLeastMs?: number; traffic?: boolean } & (
      { id: string; saved?: never } | { saved: SimulationMatch; id?: never }
    ))
  /** The diagram has a saved simulation like this (authored in Simulations…), running or not. */
  | { kind: "savedSimulation"; match: SimulationMatch }
  /**
   * A saved expectation id is stable across languages; Words also matches a chip's displayed label. outcome: what the
   * chip must say, "pass" by default; "either" once it's decided, met or failed.
   */
  | { kind: "expectation"; simulation: string; label: string | Words; outcome?: "pass" | "fail" | "either" }
  /** A Fault is active on the subject; absent: none is (Restore cleared it), while Live runs. */
  | ({ kind: "fault"; fault?: FaultKind; absent?: true } & PropertyTarget)
  | { kind: "trace" }
  /** Slow motion is on; finished: its message's journey has played to the end (the machine's `finished`). */
  | { kind: "slowmo"; finished?: true }
  /** A Live panel or view is open (or closed), as Live publishes it. */
  | { kind: "liveView"; view: LiveView; open: boolean }
  /** A Live hover card is open: on this subject or connection, or on anything. */
  | ({ kind: "readout" } & (PropertyTarget | { subject?: never; edge?: never }))
  /** Live's what-if input (Inputs panel): Traffic × 3 is `{ input: "traffic", op: "=", value: 3 }`; unset is 1. */
  | { kind: "inputs"; input: LiveInput; op: MetricComparison; value: number }
  | { kind: "note"; waiting: boolean }
  | { kind: "mode"; value: EditorModeValue; subject?: string }
  | { kind: "selection"; subjects?: readonly string[]; atLeast?: number; exact?: boolean }
  | { kind: "aligned"; subjects?: readonly string[]; axis: "x" | "y"; atLeast?: number }
  | { kind: "dependencies"; visible: boolean }
  | { kind: "presenting"; on: boolean }
  | { kind: "sharing" }
  /** A lesson acknowledged with Done after trying its control. */
  | { kind: "acknowledge" }
  | { kind: "all"; checks: readonly Check[] };

/** Done for you ("Skip step"), through the editor API: one undo step each, as if the learner did it. */
export type Demo =
  | { kind: "add"; subject: string; stencil: string; after?: string }
  | { kind: "connect"; from: string; to: string; sourceSide?: Side; targetSide?: Side }
  | { kind: "reconnect"; edge: readonly [string, string]; to: string }
  | { kind: "insert"; edge: readonly [string, string]; subject: string; stencil: string }
  | { kind: "field"; subject: string; field: "sublabel" | "description"; value: Words }
  | { kind: "name"; subject: string }
  | { kind: "rename"; subject: string; label: Words }
  | ({ kind: "prop"; props: Record<string, unknown> } & PropertyTarget)
  /**
   * Edit-preserving prop edits, applied together as one edit, or none when nothing is missing. `runs`: these runs'
   * own setup (saved Inputs, a connection's run-only caller settings) must not override them either; only the keys
   * still overridden are merged into it (src/tutorials/repair.ts).
   */
  | ({ kind: "patch"; patches: readonly PropPatch[]; runs?: readonly RunRef[] } & PropertyTarget)
  | { kind: "relation"; from: string; to: string; relation: EdgeRelation; edgeKind?: "sync" | "async" }
  | { kind: "group"; subjects: readonly string[]; boundary: string }
  | { kind: "annotate"; annotation: AnnotationKind }
  | { kind: "runSimulation"; id: string }
  /** Continuous traffic on or off, through Live's own control (the registry's "sim.traffic"). */
  | { kind: "traffic"; on: boolean }
  /** Follow the next message, through Live's own "Trace a message › Next message". */
  | { kind: "trace" }
  /**
   * Watch one message in slow motion, through Live's own action: from this subject ("Watch one message in slow motion"
   * on its menu), or the next anywhere ("Trace a message › Next message, in slow motion").
   */
  | { kind: "slowmo"; subject?: string }
  /** Send messages into a subject, through Live's own "Inject › 1 / 10 / 100". */
  | { kind: "inject"; subject: string; count: 1 | 10 | 100 }
  /** The bottleneck's suggested fix, through Live's own "Apply fix" (the registry's "sim.capacity-fix"). */
  | { kind: "applyFix" }
  /** Set one of Live's what-if inputs, as the Inputs panel does. */
  | { kind: "inputs"; input: LiveInput; value: number }
  /**
   * Continue a paused narration note, as its Continue button does: once that saved run has played to atLeastMs,
   * continuing any note that pauses it on the way, so the run reaches the note the step is about.
   */
  | { kind: "continueNote"; simulation: string; atLeastMs?: number }
  /** Open a Live panel or view, as its control does. */
  | { kind: "openView"; view: LiveView }
  /**
   * Save a simulation, as Simulations… does: a Drill step per fault preset (on the diagram's own targets, as the
   * preset picks them) and these expectations. Edit-preserving: a saved simulation with this id keeps what it has
   * and gets only what's missing.
   */
  | {
      kind: "saveSimulation";
      id: string;
      title: Words;
      drills?: readonly { preset: DrillPreset; atMs: number }[];
      expectations?: readonly Expectation[];
    }
  | ({ kind: "fault"; fault: FaultKind; restore?: boolean } & PropertyTarget)
  | { kind: "select"; subjects: readonly string[] }
  | { kind: "member"; subject: string; boundary: string }
  | {
      kind: "align";
      subjects?: readonly string[];
      mode: "middle";
      /** Keep a sufficient learner selection; otherwise select these subjects before aligning. */
      selection?: { atLeast: number; fallback: readonly string[] };
    }
  /** Set the remembered Dependencies visibility, including during resume reconstruction. */
  | { kind: "dependencies"; visible: boolean }
  | { kind: "present"; on: boolean }
  | { kind: "live" };

/**
 * One action of the solution path, by test id only. The generated e2e plays these through the real UI. A test id can
 * name a subject (`node-{api}`) or the connection between two (`edge-label-{api->config}`): the first edge from one
 * to the other, whatever its saved id.
 */
export type UiStep =
  | { click: string }
  /** Open a disclosure, keeping it open when a previous lesson already opened it. */
  | { open: string }
  | { modClick: string; modifiers: readonly ("Shift" | "Control" | "Meta" | "Alt")[] }
  | { rightclick: string }
  | { boxSelect: string; around: readonly string[] }
  | { select: string; value: string }
  | { pane: "dblclick" }
  | { dblclick: string }
  | { hover: string }
  | { fill: string; text: string | Words }
  | { press: string }
  | { type: Words }
  /** Type at the caret of this field, which already has focus (after a click and keys there): appended, not replaced. */
  | { type: string; text: string | Words }
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
   * "annotation": likewise, until the annotation's text editor has closed (its edit committed), as the mode says.
   * selection: wait for this selection, then keep it settled while the check holds (Undo can still reopen it).
   *
   * Skip completes a step through the same contract: the demo's edits while the check doesn't hold, then this
   * settlement's own action (finish naming, close the annotation editor, select the subjects). Each part runs only while
   * it's missing, so Skip from `completing` never repeats an edit. A demo lists edits only, never settlement.
   */
  settle?: "naming" | "annotation" | { kind: "selection"; subjects: readonly string[]; tip: Words };
  /** What the canvas is guided to while this step is current: quick-add opens searched for this (its pick). */
  guide?: { quickAdd?: Words };
  targets: readonly Target[];
  demo: readonly Demo[];
  solution: readonly UiStep[];
  /** Done is allowed only for explicit acknowledgment checks. */
  keyboardSolution?: readonly KeyboardUiStep[];
}

export interface TutorialMetadata {
  id: string;
  title: Words;
  /** Unavailable to learners while regressions are tracked; saved progress is retained. */
  quarantined?: true;
}

export interface Tutorial extends TutorialMetadata {
  /** Bumped when steps change meaning: saved progress for another version starts over. */
  version: number;
  track: TrackId;
  level: 1 | 2 | 3;
  minutes: number;
  summary: Words;
  /** The sandbox's first diagram. A function: its title is translated when it opens. */
  start: (() => DiagramFile) | { example: string; simulation?: string };
  /** Share, Present and File lessons keep the app's real controls above the tutorial bar. */
  chrome?: "app";
  /**
   * A design study: its steps are milestones, so the strip states the outcome and the coach mark points only once
   * "Show me" is pressed (targetsShown in ./machine.ts). Skip applies the reference change.
   */
  study?: true;
  subjects: Readonly<Record<string, SubjectSpec>>;
  steps: readonly TutorialStep[];
  finish: { text: Words; example?: { slug: string; label: Words } };
}
