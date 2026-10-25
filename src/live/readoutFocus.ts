import { defineMachine } from "../lib/machine";

type FocusState = { value: "unclaimed" | "held" | "cancelled" | "transferred" };
/** Vacant means a DOM replacement dropped focus to body, without a new focus event. */
export type ReadoutFocusAt = "readout" | "opener" | "vacant" | "other";
type FocusEvent =
  | { type: "open"; at: ReadoutFocusAt; pinned: boolean }
  | { type: "focus"; at: ReadoutFocusAt }
  | { type: "claim"; at: ReadoutFocusAt; pinned: boolean; eligible: boolean };

/**
 * Each transfer must acquire the readout before it can hand focus to its replacement.
 * Full transition table (every unmatched guard is a no-op; * emits the focus command):
 *
 * State       | open pinned at readout | other open | focus readout | focus opener | focus vacant | focus other | claim eligible pinned at opener | claim eligible at vacant | other claim
 * unclaimed   | held                   | unclaimed  | held          | unclaimed    | cancelled    | cancelled   | transferred*                    | unclaimed                | unclaimed
 * held        | held                   | held       | held          | cancelled    | held         | cancelled   | held                            | transferred*             | held
 * cancelled   | cancelled              | cancelled  | held          | cancelled    | cancelled    | cancelled   | cancelled                       | cancelled                | cancelled
 * transferred | transferred            | transferred | held          | cancelled    | transferred  | cancelled   | transferred                     | transferred              | transferred
 *
 * focus(readout) records entry into this request's target, including explicit re-entry after
 * cancellation. A claim still checks that the target is current, eligible and unobstructed.
 * Vacant is replacement fallout, never explicit re-entry; completion at the opener cannot
 * revive a cancelled claim. A new target/pinning request starts a fresh machine.
 */
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
    cancelled: {
      focus: { target: "held", guard: (_s, e) => e.at === "readout" },
    },
    transferred: {
      focus: [
        { target: "held", guard: (_s, e) => e.at === "readout" },
        { target: "cancelled", guard: (_s, e) => e.at !== "vacant" },
      ],
    },
  },
});
