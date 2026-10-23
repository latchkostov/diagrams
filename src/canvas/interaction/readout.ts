/** Live readouts are independent of selection and particle tracing. */
export interface ReadoutTarget {
  kind: "node" | "edge";
  id: string;
}
export interface ReadoutState {
  open: (ReadoutTarget & { pinned: boolean }) | null;
  dismissed: ReadoutTarget | null;
}
/**
 * `point`: the pointer or keyboard focus names an item (or nothing). `pin`: a click or Enter keeps it. `close`: Esc
 * (it stays dismissed until something else is pointed at). `release`: keyboard traversal moves on from a pinned card,
 * so it becomes an ordinary summary that the next item replaces.
 */
export type ReadoutEvent =
  | { type: "point"; target: ReadoutTarget | null }
  | { type: "pin"; target: ReadoutTarget }
  | { type: "close" }
  | { type: "release" };
export const initialReadout = (): ReadoutState => ({ open: null, dismissed: null });
const same = (a: ReadoutTarget | null, b: ReadoutTarget | null) => a?.kind === b?.kind && a?.id === b?.id;

export function readout(state: ReadoutState, event: ReadoutEvent): ReadoutState {
  if (event.type === "close") return { open: null, dismissed: state.open ?? state.dismissed };
  if (event.type === "pin") return { open: { ...event.target, pinned: true }, dismissed: null };
  if (event.type === "release")
    return state.open?.pinned ? { open: { ...state.open, pinned: false }, dismissed: null } : state;
  if (state.open?.pinned) return state;
  if (state.dismissed && same(event.target, state.dismissed)) return state;
  if (same(event.target, state.open) && !state.dismissed) return state;
  return { open: event.target ? { ...event.target, pinned: false } : null, dismissed: null };
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
