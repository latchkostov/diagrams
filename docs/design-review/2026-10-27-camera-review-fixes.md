## PR 377 review fixes

No controls or chrome were added. Follow preserves the user's camera while retaining already-visible
narration cards and their Live readouts. Region titles share placement reservations across renderers;
active zone editors keep the correct readable size. Editor containment follows camera and pane
changes, including the selection reveal that can finish after editing opens.

Reviewed the pane-edge transition, overlapping region anchors and phone renaming at 35%, 100%
and 150%. The Lab exposes the region collision fixture. The large-showcase audit requires every
expected title before checking collisions. Off-screen cards retain the existing pin treatment.

Rejected moving an already-visible narration subject inward: it would break camera preservation.
Rejected dropping titles on collision-budget exhaustion: stacking keeps their names available
without unbounded collision search. Existing budgets and assertions stay intact.
