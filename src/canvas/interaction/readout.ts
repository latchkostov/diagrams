/** Live readouts are independent of selection and particle tracing. */
export interface ReadoutTarget {
  kind: "node" | "edge";
  id: string;
}
export interface ReadoutState {
  open: (ReadoutTarget & { pinned: boolean }) | null;
  dismissed: ReadoutTarget | null;
}
export type ReadoutEvent =
  { type: "point"; target: ReadoutTarget | null } | { type: "pin"; target: ReadoutTarget } | { type: "close" };
export const initialReadout = (): ReadoutState => ({ open: null, dismissed: null });
const same = (a: ReadoutTarget | null, b: ReadoutTarget | null) => a?.kind === b?.kind && a?.id === b?.id;

export function readout(state: ReadoutState, event: ReadoutEvent): ReadoutState {
  if (event.type === "close") return { open: null, dismissed: state.open ?? state.dismissed };
  if (event.type === "pin") return { open: { ...event.target, pinned: true }, dismissed: null };
  if (state.open?.pinned) return state;
  if (state.dismissed && same(event.target, state.dismissed)) return state;
  if (same(event.target, state.open) && !state.dismissed) return state;
  return { open: event.target ? { ...event.target, pinned: false } : null, dismissed: null };
}
