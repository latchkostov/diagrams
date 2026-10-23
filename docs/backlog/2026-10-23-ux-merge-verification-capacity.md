## Complete broad verification of the PR #255 merge in CI

Both requested Linux quick-gate attempts exited 75 because another gate held all 12 available slots.
The selected specs were hover-cards, message-types, a11y and live; inspector-live was absent.
No lock or resource reservation was bypassed or removed.

A separate local unit run hit the old skill ZIP cap before its packing fix and five-second
timeouts in skill exports/layout, public-example checks, scalingPlanner, retry-storm and
waits.sampling. It was interrupted rather than repeatedly running the full suite under contention.
The full parity Node tier passed 1,845 tests; its one mismatch was the combined i18n catalog,
which was reviewed and regenerated separately. Browser parity lost its preview server to
`ENOMEM: not enough memory, read`, so that tier was interrupted and its owned container stopped.
These broad runs are incomplete. A focused branch rerun passed 207 tests and timed out three:
retry-storm evidence, the refined scaling peak and the 500 CPU-ms sampled caller. The isolated
retry-storm evidence rerun passed (14 tests including the type-check project).

The same three affected spec files ran twice against a clean source archive of
`origin/master` at `643f61b6dc94a64248c8ffd152f69bd979d9ebb4`, inside this checkout's ignored
output directory, with the identical lockfile dependencies and one worker. Run 1: **197 passed,
3 failed**; run 2: **198 passed, 2 failed**, with no type errors. Both reproduced the refined-peak
timeout and another scaling capacity-history timeout; run 1 also reproduced the sampled
500 CPU-ms caller timeout. The assertions and backstops remain unchanged. CI must complete
unit coverage and browser parity with zero retries.
