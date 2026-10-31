## Inspector geometry belongs to the settled pane

The council inspector test fails in both native macOS baselines with an inset of **-355px**. Its screenshot has the correct final inset: the test reads the collapsed dock at x=1439, then reads the note after the dock opens at x=1068. Comparing boxes from those different panes produces the negative inset.

The test now waits for the existing selection-settled signal before measuring. A deterministic Windows regression pauses the clock across pointer-up's deferred reveal: the original reader fails the unchanged **at least 16px** inset requirement; the repaired reader remains pending until the reveal and reads the settled geometry. No product padding, camera behavior, viewport size, expectation or tolerance is changed.

The simulation field test also keeps the API's explicit Focus setup, then fits before clicking the unrelated topic edge. Both macOS baselines show the Fit view button intercepting that edge's pointer input. This follows the existing unrelated-subject preparation contract in QUALITY.md; the actual field, focus and saved-value assertions remain intact.

Native and Linux repetitions, including the timing-sensitive neighbour cohort, are recorded in the verification fragment and PR. Application outputs and goldens remain unchanged.
