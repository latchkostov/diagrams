## Reproduce the checks responsiveness deadline under full-suite pressure

The Linux full gate on `69ec137a52f30187f9b5a0f2573dcb88fc0ad9e3` passed 2,029 browser
cases but the existing checks typing comparison reached its 120-second whole-test backstop
at `finished()` while awaiting `stats.pending === false` (`checks-ui.spec.ts:436`).
This does not establish that one check request was stuck: the test performs 21 adjacent pairs.

## Bounded rechecks

The affected spec passed both isolated repetitions at eight workers/eight CPUs on that branch
(26 passed) and on the clean pre-sampling master snapshot
`2153bf3191f6d1acf067ab2e09104f76fde397ed` (26 passed). Thus the failure is not claimed
as a reproduced baseline failure. The preceding full run also passed this case.
No timeout, workload, readiness assertion or responsiveness ratio was changed.

## Follow-up

Capture per-pair progress and worker completion under full-suite contention to distinguish
cumulative workload from a missing completion. Preserve the matched baselines, real worker
execution and existing responsiveness assertion. Resilience dispatch is not used by this fixture;
the ordinary checks execution and scheduler paths were unchanged in the failing branch.
