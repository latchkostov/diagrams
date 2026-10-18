## Pending work when slow motion takes the view (2026-10-18)

The existing camera contract gives slow motion its own view and plans against the settled pane.
Starting it while older work waits now folds that work into one take. Keeping the older panel
refit would allow a centre or refit to replace the replay's view; merely clearing it would lose
the pending room adjustment. The take handles the current room once and clears the work.

No controls or text change. Idle starts, manual interruptions, later panel changes and restoring
the previous view keep their existing rules. The row test and fixed seed regression cover the
exact panel/start/settle sequence; a controller regression also covers a deferring menu.
