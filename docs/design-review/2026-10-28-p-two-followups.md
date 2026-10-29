## P2 follow-ups UX review

Reviewed the affected component changes and browser regressions against the keyboard, context,
camera and chrome rules in `docs/UX-PRINCIPLES.md`. This was a source and test review; browser gate
results are recorded separately in the PR.

The low-zoom Config settings card now uses the existing tooltip dismissal lifecycle. Selection
still exposes its settings below 60%, while Escape can dismiss the card and preserve keyboard
focus on the connection. The 50% regression also checks canvas deselection. This restores the
existing keyboard affordance without adding controls, hints or another dismissal mode.

Camera-owned pans in a Custom view retain identity fitting in their completion boundary. Pointer
pans still schedule their entrants before paint, and the held-frame regression now requires the
target card to be inside the pane before checking its readable name. Protected parts remain named
through the real identity component wiring.

The failing and stressed chip tests check computed border, tint and inset accent at 40% and 25%,
including recovery. The existing palette, inspector, menus, presentation chrome and export
surfaces gain no controls or copy. Benchmark workload reset and persistence waits affect test
setup only. No additional UX changes are required in this batch.
