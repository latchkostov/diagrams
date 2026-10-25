import { defineMachine, machineStep } from "../../lib/machine";

/** Live readouts are independent of selection and particle tracing. */
export interface ReadoutTarget {
  kind: "node" | "edge";
  id: string;
}
export interface ReadoutState {
  value: "closed" | "summary" | "pinned";
  open: (ReadoutTarget & { pinned: boolean }) | null;
  dismissed: ReadoutTarget | null;
  /** Focus ownership survives the DOM commit that removes a target. */
  focused: ReadoutTarget | null;
}
/**
 * `point`: the pointer or keyboard focus names an item (or nothing). `pin`: a click or Enter keeps it. `close`: Esc
 * (it stays dismissed until something else is pointed at). `release`: keyboard traversal moves on from a pinned card,
 * so it becomes an ordinary summary that the next item replaces.
 */
export type ReadoutEvent =
  | { type: "point"; target: ReadoutTarget | null }
  | { type: "pin"; target: ReadoutTarget }
  | { type: "focus"; target: ReadoutTarget | null }
  | { type: "close" }
  | { type: "release" };
export const initialReadout = (): ReadoutState => ({ value: "closed", open: null, dismissed: null, focused: null });
const same = (a: ReadoutTarget | null, b: ReadoutTarget | null) => a?.kind === b?.kind && a?.id === b?.id;
const node: ReadoutTarget = { kind: "node", id: "node" };
const edge: ReadoutTarget = { kind: "edge", id: "edge" };
const canPoint = (s: ReadoutState, target: ReadoutTarget | null) =>
  !s.open?.pinned &&
  !s.focused &&
  !(s.dismissed && same(target, s.dismissed)) &&
  !(same(target, s.open) && !s.dismissed);
const focusRow = (value: ReadoutState["value"]) => ({
  target: value,
  reduce: (s: ReadoutState, e: ReadoutEvent): ReadoutState => ({
    ...s,
    focused: e.type === "focus" && same(e.target, s.open) ? e.target : null,
  }),
});

/** Ownership stays in the controller's synchronous machine, never in React effect flags. */
export const readoutMachine = defineMachine<ReadoutState, ReadoutEvent>({
  initial: initialReadout(),
  states: ["closed", "summary", "pinned"],
  events: [
    { type: "point", target: node },
    { type: "point", target: edge },
    { type: "point", target: null },
    { type: "pin", target: node },
    { type: "focus", target: node },
    { type: "focus", target: null },
    { type: "close" },
    { type: "release" },
  ],
  on: {
    closed: { focus: focusRow("closed") },
    summary: { focus: focusRow("summary") },
    pinned: { focus: focusRow("pinned") },
    "*": {
      point: [
        {
          target: "summary",
          guard: (s, e) => !!e.target && canPoint(s, e.target),
          reduce: (_s, e) => ({
            value: "summary",
            open: { ...e.target!, pinned: false },
            dismissed: null,
            focused: null,
          }),
        },
        { target: "closed", guard: (s, e) => !e.target && canPoint(s, null), reduce: () => initialReadout() },
      ],
      pin: {
        target: "pinned",
        reduce: (s, e) => ({
          value: "pinned",
          open: { ...e.target, pinned: true },
          dismissed: null,
          focused: same(e.target, s.open) ? s.focused : null,
        }),
      },
      close: {
        target: "closed",
        reduce: (s) => ({ value: "closed", open: null, dismissed: s.open ?? s.dismissed, focused: null }),
      },
      release: {
        target: "summary",
        guard: (s) => !!s.open?.pinned,
        reduce: (s) => ({ value: "summary", open: { ...s.open!, pinned: false }, dismissed: null, focused: null }),
      },
    },
  },
});

export function readout(state: ReadoutState, event: ReadoutEvent): ReadoutState {
  return machineStep(readoutMachine, state, event).state;
}

/** Where keyboard focus sits in a readout card, as the DOM port reads it (domPort.ts, readoutStop). */
export interface ReadoutStop {
  /** The card's node or connection. */
  target: ReadoutTarget;
  pinned: boolean;
  /** Focus is on the card itself rather than a control inside it. */
  card: boolean;
  /** Focus is on the card's last Tab stop (the card itself when it has no other). */
  last: boolean;
}

/**
 * Where Tab goes from inside a readout. Cards are portalled outside canvas-wrap, so canvas navigation bridges them
 * into its reading order: node → its readout → the next node, and back the same way.
 *
 * | Row | Readout  | Focus on                 | Tab                         | Shift+Tab                    |
 * | --- | -------- | ------------------------ | --------------------------- | ---------------------------- |
 * | T1  | unpinned | anywhere in it           | next (after its item)       | owner (its node/connection)  |
 * | T2  | pinned   | the card itself          | native (its first section)  | owner                        |
 * | T3  | pinned   | a section or a control   | native (the next stop)      | native (the previous stop)   |
 * | T4  | pinned   | its last Tab stop        | next (after its item)       | as T2 / T3                   |
 *
 * An unpinned summary is one Tab stop (its section rows are reached with the arrow keys, or by pinning it).
 */
export function readoutTab(at: ReadoutStop, back: boolean): "owner" | "next" | "native" {
  if (!at.pinned) return back ? "owner" : "next";
  if (back) return at.card ? "owner" : "native";
  return at.last ? "next" : "native";
}
