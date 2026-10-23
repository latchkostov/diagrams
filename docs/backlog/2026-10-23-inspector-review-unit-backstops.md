## Native unit backstops during the Inspector review

The raw Windows unit run under concurrent browser-gate load finished with 14,925 passed,
15 failed, 10 expected failures and 10 skipped; type checking passed. Every failure hit the
existing five-second hang backstop. No assertion or timeout was changed. This is further evidence for the existing
[unit-load follow-up](2026-10-23-edge-review-unit-load.md), rather than a simulation behavior change.

Only the failing specs were checked in an untouched `origin/master` archive at
`87e75d9337fbfe61b3c5446e11ee46c4232e6e3d`, inside this checkout's ignored output directory,
using the same installed Vitest and two workers. The skill, public-example and sampled-wait files
ran twice: 355 passed / 4 failed, then 354 passed / 5 failed. Both reproduced the same public-example
and sampled-wait backstops; the second also hit the busy-thread example's evidence backstop.
The scaling-planner file ran twice: 39 passed / 3 failed, then 40 passed / 2 failed. Those runs
reproduced all three scaling-planner cases seen on the branch. The thread-fix file reproduced its
same failure twice (15 passed / 1 failed each); retry no-op parity reproduced its same failure twice
(13 passed / 1 failed each). Retry-storm outcome bands ran twice: 6 passed / 4 failed, then 10 passed.
The first reproduced seeds 1, 7, 17 and 42; seed 99's branch backstop did not reproduce.
No full master suite was run.

One CLI colour-export case also failed in the raw branch run. Its targeted branch check passed,
both targeted master checks passed, and the complete skill file passed in both master runs.
That individual failure and retry-storm seed 99 were not reproduced; retain them as unresolved load-related observations,
not as a proven master failure. Check the normal CI environment before changing its behavior or
its hang backstop.

The requested Linux three-repeat gate and its retry, and the final full-gate admission attempt,
returned busy (75) while the shared worker budget was occupied. They produced no SUMMARY line.
Inspector regressions, held-chunk focus/naming checks and the screenshot review passed separately.
