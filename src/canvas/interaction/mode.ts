import { defineMachine, machineStep, type Transition } from "../../lib/machine";
import type { CanvasSurfaceKind } from "./types";

/**
 * The editor's mode, as the interaction controller (controller.ts) already knows it: what the person is in the middle
 * of. One explicit machine instead of flags spread over the canvas, so a reader (a tutorial step, a test) hears its
 * transitions rather than watching the DOM or focus.
 *
 *   editing  ── menu.opened ──▶ menu | quickAdd     (closing goes back to editing, or to the field it came from)
 *   editing  ── gesture.started ──▶ gesture          (a drag: connect, an edge end, a bend)
 *   editing  ── field.focused (a name field) ──▶ naming(target)   ── naming.done | field.left ──▶ editing
 *   editing  ── naming.requested ──▶ naming(target)  (the field is still downloading)
 *   editing  ── field.focused (another field) ──▶ field(name)     ── field.left ──▶ editing
 *
 * Live is a region of its own beside these (`live`: off, playing or paused): a menu opens in Live too, and a node is
 * explicitly named in Live's property sheet; a node double-click opens Properties without naming. The selection and
 * the open annotation editor ride along as data, each commit. Commands describe commit, release and focus work:
 * controller feeds it from the events it already decides (menus, gestures, focusin/focusout, naming.done) and from
 * Live's session (useLiveSessionState.ts). The controller executes the work through its ports.
 */
export type EditorModeValue =
  "editing" | "menu" | "quickAdd" | "gesture" | "naming" | "committing" | "released" | "field";
export interface EditorModeState {
  value: EditorModeValue;
  /** The naming owner, including commit and released focus wait (its flow id). */
  target: string | null;
  /** field: the Inspector field (its test id without "inspector-field-"). */
  field: string | null;
  /** Distinguishes successive requests for the same item; late focus cannot complete a newer owner. */
  namingRequest: number;
  /** A click-away commits the name but leaves focus with the pointer's destination. */
  namingPointerAway?: boolean;
  /** Where a menu or a gesture began: closing it goes back there (a field's own menu, say). */
  resume: { value: "editing" | "naming" | "field"; target: string | null; field: string | null } | null;
  live: "off" | "playing" | "paused";
  /** The selected flow ids, as last committed. */
  selection: readonly string[];
  /** The annotation whose text editor is open, as last committed (its edit commits as the editor closes). */
  annotating?: string | null;
}
export type EditorModeEvent =
  | { type: "menu.opened"; kind: CanvasSurfaceKind }
  | { type: "menu.closed" }
  | { type: "gesture.started" }
  | { type: "gesture.ended" }
  /** Focus arrived on a text field: a name field (`target`, its item) or another one (`field`). */
  | { type: "field.focused"; target?: string; field?: string }
  /** The name field was requested but cannot take focus yet. */
  | { type: "naming.requested"; target: string }
  | { type: "naming.accepted"; target: string }
  | { type: "naming.pointerAway"; target: string }
  | { type: "naming.committed"; target: string }
  | { type: "naming.focused"; target: string; request: number }
  | { type: "naming.cancelled"; target: string }
  | { type: "node.doubleClicked"; target: string }
  /** Focus left the fields for the canvas, a button or nothing. */
  | { type: "field.left" }
  /** Enter or Esc in a name field (the focus policy's row N1 hears it too). */
  | { type: "naming.done" }
  | { type: "live"; state: EditorModeState["live"] }
  | { type: "selection"; ids: readonly string[] }
  | { type: "annotating"; id: string | null };

export const initialEditorMode: EditorModeState = {
  value: "editing",
  target: null,
  field: null,
  namingRequest: 0,
  resume: null,
  live: "off",
  selection: [],
};

const here = (s: EditorModeState) => ({
  value: s.value === "naming" || s.value === "field" ? s.value : ("editing" as const),
  target: s.value === "naming" ? s.target : null,
  field: s.value === "field" ? s.field : null,
});
const back = (s: EditorModeState): EditorModeState => ({ ...s, ...(s.resume ?? here(s)), resume: null });
const into = (value: "menu" | "quickAdd" | "gesture") => (s: EditorModeState) => ({
  ...s,
  value,
  target: null,
  field: null,
  // Where it began, to go back to (a menu replacing a menu keeps where the first began).
  resume: s.resume ?? here(s),
});
const focused = (s: EditorModeState, e: EditorModeEvent): EditorModeState =>
  (e.type === "field.focused" || e.type === "naming.requested") && e.target
    ? {
        ...s,
        value: "naming",
        target: e.target,
        field: null,
        namingRequest: s.namingRequest + 1,
        namingPointerAway: false,
      }
    : { ...s, value: "field", target: null, field: e.type === "field.focused" ? (e.field ?? null) : null };
const settled = (s: EditorModeState): EditorModeState => ({ ...s, value: "editing", target: null, field: null });
const isMenu = (e: EditorModeEvent) => e.type === "menu.opened" && e.kind !== "quickAdd" && e.kind !== "connected";

export type EditorModeCommand =
  | { type: "node.properties"; target: string; field?: "label" }
  | { type: "naming.commit" | "naming.release" | "naming.focus"; target: string; request: number };
type Row = Transition<EditorModeState, EditorModeEvent, EditorModeCommand>;
const named = (_s: EditorModeState, e: EditorModeEvent) => e.type === "field.focused" && !!e.target;
const resumes = (value: "naming" | "field") => (s: EditorModeState) => s.resume?.value === value;
/** The rows several modes share: a menu opening, a field taking focus, a menu or a gesture going back. */
const opens: Row[] = [
  { target: "menu", guard: (_s, e) => isMenu(e), reduce: into("menu") },
  { target: "quickAdd", reduce: into("quickAdd") },
];
const fields: Row[] = [
  { target: "naming", guard: named, reduce: focused },
  { target: "field", reduce: focused },
];
const returns: Row[] = [
  { target: "naming", guard: resumes("naming"), reduce: back },
  { target: "field", guard: resumes("field"), reduce: back },
  { target: "editing", reduce: back },
];
const gestures: Row = { target: "gesture", reduce: into("gesture") };
const finished: Row = { target: "editing", reduce: settled };
const owns = (s: EditorModeState, e: EditorModeEvent) => "target" in e && s.target === e.target;
/**
 * Buffered naming handover (all other handover events/cells are ignored):
 *
 * State       accepted(owner)       pointerAway(owner)       committed(owner)           focused(owner)   cancelled(owner)
 * naming      committing / commit  committing / commit     ignore                     ignore           editing
 * committing  ignore               committing / no focus   released / release, focus  ignore           editing
 * released    ignore               ignore                  ignore                     editing          editing
 * others      ignore               ignore                  ignore                     ignore           ignore
 * After pointerAway, committed releases capture without scheduling item focus.
 *
 * Wrong owners are ignored. Committing ignores focus/blur/menu noise from the synchronous document commit.
 * Released holds NO keys: ordinary fields, menus, gestures and naming requests can supersede its pending focus.
 * The controller executes commit before sending committed, then releases capture before asking the focus policy
 * to wait for the item. Late focus/cancellation must never finish a newer owner's naming.
 */
const cancelNaming: Row = { ...finished, guard: owns };

export const editorModeMachine = defineMachine<EditorModeState, EditorModeEvent, EditorModeCommand>({
  initial: initialEditorMode,
  states: ["editing", "menu", "quickAdd", "gesture", "naming", "committing", "released", "field"],
  events: [
    { type: "menu.opened", kind: "context" },
    { type: "menu.opened", kind: "connected" },
    { type: "menu.closed" },
    { type: "gesture.started" },
    { type: "gesture.ended" },
    { type: "field.focused", target: "n1" },
    { type: "field.focused", field: "rate" },
    { type: "field.left" },
    { type: "naming.done" },
    { type: "naming.requested", target: "n1" },
    { type: "naming.accepted", target: "n1" },
    { type: "naming.pointerAway", target: "n1" },
    { type: "naming.committed", target: "n1" },
    { type: "naming.focused", target: "n1", request: 1 },
    { type: "naming.cancelled", target: "n1" },
    { type: "node.doubleClicked", target: "n1" },
  ],
  on: {
    "*": {
      "node.doubleClicked": [
        {
          target: "editing",
          guard: (s) => s.live !== "off",
          reduce: (s) => ({ ...settled(s), resume: null }),
          effects: (_s, e) => [{ type: "node.properties", target: e.target }],
        },
        {
          target: "naming",
          reduce: (s, e) => ({ ...s, value: "naming", target: e.target, field: null, resume: null }),
          effects: (_s, e) => [{ type: "node.properties", target: e.target, field: "label" }],
        },
      ],
    },
    editing: {
      "menu.opened": opens,
      "gesture.started": gestures,
      "field.focused": fields,
      "naming.requested": { target: "naming", reduce: focused },
    },
    menu: { "menu.opened": opens, "menu.closed": returns },
    // Quick-add's pick opens the new node's name: its focus can arrive before the menu has gone.
    quickAdd: {
      "menu.opened": opens,
      "menu.closed": returns,
      "field.focused": { target: "naming", guard: named, reduce: (s, e) => ({ ...focused(s, e), resume: null }) },
      "naming.requested": { target: "naming", reduce: (s, e) => ({ ...focused(s, e), resume: null }) },
    },
    // A menu opened mid-gesture ends it: back to where the gesture began.
    gesture: {
      "gesture.ended": returns,
      "menu.opened": opens.map((row) => ({
        ...row,
        reduce: (s: EditorModeState) => ({ ...into(row.target as "menu")(s), resume: s.resume }),
      })) as Row[],
    },
    naming: {
      "naming.pointerAway": {
        target: "committing",
        guard: owns,
        reduce: (s) => ({ ...s, namingPointerAway: true }),
        effects: (s, e) => [{ type: "naming.commit", target: e.target, request: s.namingRequest }],
      },
      "naming.accepted": {
        target: "committing",
        guard: owns,
        effects: (s, e) => [{ type: "naming.commit", target: e.target, request: s.namingRequest }],
      },
      "naming.cancelled": cancelNaming,
      "naming.done": finished,
      "field.left": finished,
      "field.focused": fields,
      "naming.requested": { target: "naming", reduce: focused },
      "menu.opened": opens,
      "gesture.started": gestures,
    },
    committing: {
      "naming.pointerAway": {
        target: "committing",
        guard: owns,
        reduce: (s) => ({ ...s, namingPointerAway: true }),
      },
      "naming.committed": {
        target: "released",
        guard: owns,
        effects: (s, e) => [
          { type: "naming.release", target: e.target, request: s.namingRequest },
          ...(s.namingPointerAway
            ? []
            : [{ type: "naming.focus" as const, target: e.target, request: s.namingRequest }]),
        ],
      },
      "naming.cancelled": cancelNaming,
      "node.doubleClicked": [],
    },
    released: {
      "naming.focused": { ...finished, guard: (s, e) => owns(s, e) && e.request === s.namingRequest },
      "naming.cancelled": cancelNaming,
      "field.focused": fields,
      "naming.requested": { target: "naming", reduce: focused },
      "menu.opened": opens,
      "gesture.started": gestures,
    },
    field: {
      "field.left": finished,
      "field.focused": fields,
      "naming.requested": { target: "naming", reduce: focused },
      "menu.opened": opens,
      "gesture.started": gestures,
    },
  },
});

/**
 * One step of the mode machine. Live and the selection are data on every mode (a region beside it): they're applied
 * here rather than as a row per mode, and leave the mode as it is.
 */
export function editorModeStep(state: EditorModeState, event: EditorModeEvent): EditorModeState {
  if (event.type === "live") return state.live === event.state ? state : { ...state, live: event.state };
  if (event.type === "selection")
    return state.selection.join() === event.ids.join() ? state : { ...state, selection: event.ids };
  if (event.type === "annotating")
    return (state.annotating ?? null) === event.id ? state : { ...state, annotating: event.id };
  return machineStep(editorModeMachine, state, event).state;
}
