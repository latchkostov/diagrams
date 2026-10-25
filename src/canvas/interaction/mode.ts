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
 *   editing  ── field.focused (another field) ──▶ field(name)     ── field.left ──▶ editing
 *
 * Live is a region of its own beside these (`live`: off, playing or paused): a menu opens in Live too, and a node is
 * named in Live's property sheet. The selection and the open annotation editor ride along as data, each commit. Nothing here moves focus or opens anything: the
 * controller feeds it from the events it already decides (menus, gestures, focusin/focusout, naming.done) and from
 * Live's session (useLiveSessionState.ts), and the canvas behaves exactly as before.
 */
export type EditorModeValue = "editing" | "menu" | "quickAdd" | "gesture" | "naming" | "field";
export interface EditorModeState {
  value: EditorModeValue;
  /** naming: the item whose name field has focus (its flow id). */
  target: string | null;
  /** field: the Inspector field (its test id without "inspector-field-"). */
  field: string | null;
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
  resume: null,
  live: "off",
  selection: [],
};

const here = (s: EditorModeState) => ({
  value: s.value === "naming" || s.value === "field" ? s.value : ("editing" as const),
  target: s.target,
  field: s.field,
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
  e.type === "field.focused" && e.target
    ? { ...s, value: "naming", target: e.target, field: null }
    : { ...s, value: "field", target: null, field: e.type === "field.focused" ? (e.field ?? null) : null };
const settled = (s: EditorModeState): EditorModeState => ({ ...s, value: "editing", target: null, field: null });
const isMenu = (e: EditorModeEvent) => e.type === "menu.opened" && e.kind !== "quickAdd" && e.kind !== "connected";

type Row = Transition<EditorModeState, EditorModeEvent, never>;
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

export const editorModeMachine = defineMachine<EditorModeState, EditorModeEvent>({
  initial: initialEditorMode,
  states: ["editing", "menu", "quickAdd", "gesture", "naming", "field"],
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
  ],
  on: {
    editing: { "menu.opened": opens, "gesture.started": gestures, "field.focused": fields },
    menu: { "menu.opened": opens, "menu.closed": returns },
    // Quick-add's pick opens the new node's name: its focus can arrive before the menu has gone.
    quickAdd: {
      "menu.opened": opens,
      "menu.closed": returns,
      "field.focused": { target: "naming", guard: named, reduce: (s, e) => ({ ...focused(s, e), resume: null }) },
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
      "naming.done": finished,
      "field.left": finished,
      "field.focused": fields,
      "menu.opened": opens,
      "gesture.started": gestures,
    },
    field: { "field.left": finished, "field.focused": fields, "menu.opened": opens, "gesture.started": gestures },
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
