## Toast fix round 2 UX review � PR #340

The scoped UX code review found no blocker. No controls or chrome were added. A mixed node and
boundary drop has one complete Undo action. Ordinary notifications retain their rectangle while
hidden beneath modal surfaces, leaving hit testing and keyboard navigation to those surfaces.
A blocking task exposes and focuses Cancel while any retained notification is hidden and inert.
Placement also pauses while a modal is open: the first Linux load run caught the hidden toast moving
after the modal took focus. The unchanged geometry assertion caught it; the timer now honors the modal.

Browser regressions cover the complete drag restoration and opening PNG export through Ctrl+K
from a focused notification, then cancelling by keyboard or pointer. Assertions retain actual clicks,
focus checks, geometry equality, and full restored document geometry; no forced input or time budgets.

Atomic rendering of both settlement calls keeps this fix local to drag completion. A new public
history transaction API was unnecessary for these callers; broader transaction changes would add
scope without improving this regression's completion boundary.
