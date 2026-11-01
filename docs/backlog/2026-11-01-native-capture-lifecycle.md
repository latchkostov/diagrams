## A surface mounted during capture is still inside React

Baseline Nightly 41300989083 reports two `flushSync` lifecycle errors in Linux Dev's
export-for-audience Continue case. Temporary console stack capture on Windows identifies
`mountChips` registering its capture suspension from `IdentityDetail`'s mounting effect.
Already active capture immediately invokes that registration; its old nested `flushSync`
therefore runs inside the effect. All three Windows Dev reproductions fail with that stack.

The synchronous commit now belongs to the capture entry point. Individual chip suspensions
only update their external store, including when registration happens inside a mounting effect.
The unchanged continuation case passes all three Windows Dev repetitions afterward.
Restoring the old suspension fails the new unit with the same lifecycle warning.
The new chip-surface unit mounts inside an active capture and verifies natural geometry,
absence of lifecycle errors, and restored chips after release. Existing immediate-subscriber
and nested-capture regressions remain enabled.

Full parity, reserve/size checks, the scoped reversion and Linux repetitions are recorded in
the round-seven verification fragment. No export deadline, camera policy, tolerance or budget
is changed. The separate low-zoom SVG performance work is outside this repair.
