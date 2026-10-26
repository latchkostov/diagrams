## Investigate the intermittent study-fanout inspector target

During PR #356's translated-name quarantine, the complete production Chromium run of
`tests/e2e/tutorials.spec.ts` finished with **174 passed, 1 failed**. The failing case was
`study-fanout: its solution plays through the real UI`: `play()` timed out waiting for
`inspector-section-call-advanced` during the first milestone. The initial run used two
workers, explicit ports 6680–6684 and the production E2E build, with zero retries.

The unchanged branch then passed both focused repetitions (one worker). A clean
`origin/master` at `c19dc02e3b7a04cc5def1409db620d5d82c25537`, checked out temporarily in
the same worktree and freshly built, also passed both focused repetitions (two workers).
The branch was restored afterwards. This does **not** establish that the initial failure
reproduces on master or that its cause is fixed.

Investigate selection, camera and inspector readiness before opening the advanced call
section. Preserve the solution and assertions; do not add timed waits or increase timeouts.
No lesson logic or browser assertions were changed in this quarantine round, whose review
round cap had already been reached.

The quick unit/E2E gate wrapper was busy (exit 75) and produced no SUMMARY. Standalone
targeted verification supplied the results above. The unit sweep initially had six local
5-second timeout failures; all six passed under the repository's existing CI timeout
configuration, without changing tests or timeout settings.
