## Checks typing setup: PR #278

CI run 40104947031 failed the checks scheduler's pending-state assertion in the first
`prepare(LONG)`, before render-count comparisons. History and autosave can settle before the
checks debounce. Pausing the page clock there strands a queued setup check: the label already
matches, so preparation makes no edit and never flushes it.

Wait for checks to report idle before pausing the measurement clock. Deliberately queue a setup
edit outside the samples to exercise this boundary on every run. Temporarily removing the wait
with that setup reproduces the pending-state failure; restoring it passes. Render, commit and
component equality assertions and their existing limits are unchanged.

Windows Chromium, production E2E builds, one worker, five repetitions per revision:

- Clean origin/master `d9304926`: 5 passed. Every held and running key: 20 renders, 2 commits.
- Branch `3545f759`: 3 passed, 2 setup failures matching CI. Every completed held and running
  key: 20 renders, 2 commits; failed runs never reached the measured keys.
- Fixed branch: 5 passed, zero flaky cases. Every held and running key: 20 renders, 2 commits.

No production subscription change is justified by these counts. Edge controls already mount
only for selected edges, their single-selection subscription returns a boolean, and neither
subscribes to check results. This fix changes test setup only; no UI or parity goldens change.
