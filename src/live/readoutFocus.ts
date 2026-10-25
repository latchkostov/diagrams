import { defineMachine } from "../lib/machine";

type FocusState = { value: "unclaimed" | "held" | "cancelled" | "transferred" };
/** Vacant means a DOM replacement dropped focus to body, without a new focus event. */
export type ReadoutFocusAt = "readout" | "opener" | "vacant" | "other";
type FocusEvent =
  | { type: "open"; at: ReadoutFocusAt; pinned: boolean }
  | { type: "focus"; at: ReadoutFocusAt }
  | { type: "claim"; at: ReadoutFocusAt; pinned: boolean; eligible: boolean };

/** Each transfer must acquire the readout before it can hand focus to its replacement. */
export const readoutFocusMachine = defineMachine<FocusState, FocusEvent, "focus">({
  initial: { value: "unclaimed" },
  states: ["unclaimed", "held", "cancelled", "transferred"],
  events: [
    { type: "open", at: "readout", pinned: true },
    { type: "open", at: "readout", pinned: false },
    ...(["readout", "opener", "vacant", "other"] as const).map((at) => ({ type: "focus" as const, at })),
    { type: "claim", at: "opener", pinned: true, eligible: true },
    { type: "claim", at: "opener", pinned: false, eligible: true },
    { type: "claim", at: "vacant", pinned: false, eligible: true },
    { type: "claim", at: "vacant", pinned: true, eligible: false },
  ],
  on: {
    unclaimed: {
      // Releasing a pinned card is traversal: only pinning inherits pre-commit ownership.
      open: { target: "held", guard: (_s, e) => e.pinned && e.at === "readout" },
      focus: [
        { target: "held", guard: (_s, e) => e.at === "readout" },
        { target: "cancelled", guard: (_s, e) => e.at !== "opener" },
      ],
      claim: {
        target: "transferred",
        guard: (_s, e) => e.eligible && e.pinned && e.at === "opener",
        effects: () => ["focus"],
      },
    },
    held: {
      focus: { target: "cancelled", guard: (_s, e) => e.at !== "readout" && e.at !== "vacant" },
      claim: {
        target: "transferred",
        guard: (_s, e) => e.eligible && e.at === "vacant",
        effects: () => ["focus"],
      },
    },
    transferred: {
      focus: [
        { target: "held", guard: (_s, e) => e.at === "readout" },
        { target: "cancelled", guard: (_s, e) => e.at !== "vacant" },
      ],
    },
  },
});
