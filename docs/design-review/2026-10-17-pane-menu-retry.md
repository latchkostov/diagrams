## Pending pane adjustment review

The camera holds still while a context menu is open. Closing it retries the pending pane
adjustment once: a fitted view refits clear of the Inspector; a manually controlled view
keeps its zoom and reveals the selection. Reopening a menu before the retry fires keeps
the work pending. A later menu cycle does not repeat an adjustment already applied.

This restores the existing pane policy without adding controls, menu items or text.
The chrome budget is unchanged. Keeping the acknowledgement in the existing effect
avoids a separate hook and preserves the execution-time camera ownership check.

Regressions use a paused clock and count fit transactions as well as checking node
visibility, so duplicate fits cannot hide behind an unchanged final viewport.
