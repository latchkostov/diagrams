## Ownership and focus

Buffered naming now uses the editor-mode machine's explicit handover states. The interaction
controller owns capture through its existing port and pending-input owner stack. There is no
keyboard replay queue or React effect coordinating completion.

| State       | accepted (owner)   | committed (owner)                        | focused (owner/request) | cancelled (owner) |
| ----------- | ------------------ | ---------------------------------------- | ----------------------- | ----------------- |
| naming      | committing; commit | ignored                                  | ignored                 | editing           |
| committing  | ignored            | released; release capture, request focus | ignored                 | editing           |
| released    | ignored            | ignored                                  | editing                 | editing           |
| other modes | ignored            | ignored                                  | ignored                 | ignored           |

Wrong owners and stale focus request identities are ignored. Every cell, including ignored cells,
has a unit test. Committing ignores focus/blur noise from synchronous rendering. Released holds no
keys, ignores incidental blur, and yields to new fields, menus, gestures and naming requests. The
focus policy waits for a visible item instead of discarding a focus attempt on its hidden wrapper.

Placement and a cold inspector both supply a synchronous document commit capability. The capture
stays active during that callback; only after the creation/naming transaction closes can shortcuts
run. A prefix passes directly into the next capture rather than being reread from stale render data.
Escape exercises the controller's real route, with acceptName, and preserves master's distinct
pending-placement and inspector behavior.

No controls, text or chrome are added. Rejected: releasing before commit (loses names across Undo or
cloning), retaining capture until measurement (swallows shortcuts), focusing the hidden wrapper
(loses keyboard focus), replaying shortcuts locally (changes ordering), and changing tutorial waits
or assertions (conceals the ownership race).

## Regression evidence

Six targeted unit files pass 272 tests. Removing the synchronous acceptName call fails both Enter
and controller-routed Escape commit-before-release tests. Restoring master's placement hook fails
all four held-work browser regressions: clone and quick-add followed by immediate Alt+Right, focus
after measurement, and Enter/Undo/late measurement/Redo. The implementation was restored after each
negative check.

A further regression first failed when settling an old released request cancelled a newer item
focus command. Cancellation now checks the pending move's identity. The new command survives, and
delivering the old target's measurement cannot move focus back.

The six new production Chromium cases pass once with six workers. The fixture holds both the new
card's ResizeObserver delivery and animation frames: GrowChip can force measurement through a frame
independently of ResizeObserver. Initial fixture failures exposed that bypass and an early autosave
read; the final fixture asserts the card stays hidden and polls persistence while held.

The requested Linux load run selected these regressions, unchanged text-fields.spec.ts and the two
unchanged study-cells tutorial cases, with 20 repetitions per test, six workers and three CPUs. Gate
admission reported all 12 budget slots occupied and raised BusyError (exitCode 75). No browser test
or repetition ran, and no SUMMARY line was produced. Per the busy-gate rule, this branch proceeds to
push and PR CI. Text-fields and study-cells have not been rerun locally in this round. No full gate,
full unit suite or parity run is claimed; no golden was updated.
