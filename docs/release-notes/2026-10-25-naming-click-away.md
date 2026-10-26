## Click-away saves names before placement finishes

Names typed immediately after quick-add or clone are now saved when clicking another node, even before
the new card has been measured. The name and creation stay one undo step, and the delayed reveal cannot
reopen naming or take focus back. Escape keeps the existing placement cancellation behavior.

Cold-inspector Escape regressions now observe completion and check that a typed name is saved before
the inspector finishes loading, preserving tooltip and focus checks. No parity goldens changed.
