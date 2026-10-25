## Caller history opt-in, PR #298 final fix round

Each separately flushed inspector edit keeps its own Undo step. Reselecting an enabled retry or breaker
does not add a step or clear Redo. Context-menu and Apply fix edits use the same untagged default,
so their Undo cannot discard preceding manual tuning. Explicit matching edit options remain available
for a caller that needs to join split writes.

No controls, wording, layout or defaults changed. Rejected a shared tag across all inspector tuning:
it collapses distinct user actions and breaks existing breaker and retry history contracts.
The HLC-27 browser regression retains its reselection checks and now verifies each distinct edit
through both Undo and Redo. Unit regressions cover untagged edits, a tagged edit followed by a discrete
edit, explicit coalescing, and forwarding options for saved simulations.
