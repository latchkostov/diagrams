## PR #331 quarantine verification follow-ups

The Payments quarantine round changes catalog flags and Dispatch's processed-traffic guard only;
it does not attempt further runner repairs after the round cap.

The requested `src/tutorials` unit scope ultimately passed: **17 files passed; 1,899 tests passed,
217 skipped**. Earlier concurrent runs timed out in
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`.
That case passed alone; the complete requested scope passed after the browser run stopped. No
timeout or assertion was changed.

The production-build Chromium run of `tests/e2e/tutorials.spec.ts` reported **1 failed, 30 skipped,
115 passed**. The failure was `command-palette: Skip after adding the topic selects Service 1
without a second topic`: after Skip, the canvas had three nodes where two were expected
(`tests/e2e/tutorials.spec.ts:557`). A focused repeat on this branch passed **2/2**. Investigate
the intermittent duplicate-topic path without weakening the node-count assertion.

Clean `origin/master` at `a3ad4866eaac1292ce542249969d905a4be6d423` was checked in the same worktree,
with a clean tracked tree and no stash. Its completion sweep passed twice, each with **1,224 passed,
196 skipped**; its focused command-palette browser case passed **2/2**. These failures therefore
are not confirmed as pre-existing on master. The browser failure remains an unresolved intermittent
observation, rather than a clean whole-spec result. All Playwright servers stopped when their runs ended.
