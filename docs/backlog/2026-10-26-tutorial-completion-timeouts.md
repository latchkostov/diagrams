## Tutorial completion sweep under load

The Workbench step 2 targeted run hit the existing five-second timeout in
`completionSweep.test.ts`: the retry-storm caller regression and the backoff-budget
seeded recovery regression. The unchanged simulation code is exercised by both.

## Clean-master evidence

An archive of origin/master `c19dc02e3b7a04cc5def1409db620d5d82c25537`, extracted
inside this checkout's ignored test output, ran only those two cases. It reproduced
the backoff-budget timeout (one passed, one failed; 1,860 unselected tests). The
retry-storm timeout was not reproduced in that run. The isolated root used the
same frozen dependency install; it was not a separate worktree.

No assertions, clock behavior, hang backstops or retries were changed. Investigate
the headless simulation workload and move genuinely heavy regressions to the
existing heavy lane if appropriate.
