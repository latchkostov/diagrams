## Placement and deferred pane adjustments

Quick-add owns the spot shown by its menu or outline, including when cancelled. A new item owns its
placement and any reveal needed to clear the Inspector or floating controls. Discard older pane work
when either flow takes over, and let new node and annotation editors finish opening their Inspector
without a refit.
Ordinary context menus still suspend pane work and retry it on dismissal, using the current camera
owner. No controls, strings or layout dimensions change.

Reject dropping every menu-delayed adjustment: that would restore the four context-menu regressions.
Reject coordinate tolerances or elapsed-time waits as a fix: they would hide camera ownership errors.
Use a fake clock and count fit transactions, alongside placement coordinates and the existing menu,
platform and viewport checks. Existing coordinate tests also need explicit pane readiness before
measuring a nudge, remeasuring a selection or comparing aligned items.
