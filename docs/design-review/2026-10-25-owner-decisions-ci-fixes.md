## Owner decisions: fix round 1 UX review

The designer-agent source review found no blocking issues. Rate-limit instructions appear beside
the field without adding a control or tab stop. A separate description preserves the accessible
name; invalid-number feedback remains associated alongside the persistent help.

Live node double-click retains keyboard focus on the canvas node and leaves its name unselected.
Escape therefore clears canvas selection; the F2 regression reselects the node before requesting
an explicit rename. Editing still verifies full name selection, while boundary and connection
double-click assertions retain their existing behavior.

Rejected hover-only instructions because touch and keyboard users need persistent help. Rejected
deleting Retry coverage because configured but unreachable trackers still support Retry. Rejected
broadly removing name-focus assertions: the owner exception is for node double-click in Live.
