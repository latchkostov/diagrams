## Camera and diagnostic UX review

The designer review found no blocker in the camera policy/controller change. W1b preserves
the current transform as soon as a panel changes, retaining the camera owner and saved
resume owner. A paused replay keeps its view throughout measurement; W5 still replans a
playing, fitted replay once the pane settles, and W6 prevents follow movement against
changing geometry. Manual views remain manual.

The existing fit/follow browser assertions retain exact transform equality, a single stop
with no movement, unchanged timeline position and paused state. Fixed controller cases
exercise both a scheduled and running follow transition with unmeasured pane geometry.
Playing follow briefly suspends while its pane settles. The Linux load sweep passes all
nine affected/neighbour specs in five repetitions (610 passed, zero failed or flaky),
including the existing playing-fitted replan regression.

No control, UI text or layout is added, so the chrome budget stays unchanged. Diagnostic
instrumentation is explicitly restricted to the report-only Nightly Windows job and adds
no product UI. It observes teardown resources without asserting a cleanup cause or lifting
the ordinary quarantines. This review inspected policy and tests; browser validation is
reported separately.
