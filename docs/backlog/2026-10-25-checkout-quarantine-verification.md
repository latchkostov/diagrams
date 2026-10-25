## PR #331 Checkout quarantine verification follow-ups

The Checkout quarantine round changes only catalog flags, publication assertions and documentation.
It does not attempt the saved-run caller override fix or change the tutorial runner.

The requested `src/tutorials` unit scope reported **1 failed, 1,877 passed, 238 skipped** on both
the initial two-worker run and a one-worker run after the browser stopped. The only failure was
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`,
which exceeded its existing 5,000 ms test timeout. That case passed alone on this branch. No timeout
or assertion was changed.

Clean tracked `origin/master` at `92e483ff55087b5cb18ebc30597c12b74f8032bc` reproduced the identical
timeout in two separate one-worker runs of `src/tutorials/completionSweep.test.ts`, each reporting
**1 failed, 1,364 passed, 91 skipped**. Verification used the same worktree, without a stash or another
worktree. Investigate the sweep's cumulative workload without loosening the assertion or timeout.

The initial production-build Chromium run of `tests/e2e/tutorials.spec.ts` reported **1 failed,
113 passed, 32 skipped**. `File Save as in app chrome explicitly saves the sandbox copy` failed during
`page.goto` with `net::ERR_ADDRESS_IN_USE`, before reaching an app assertion. A focused clean-master
repeat passed **2/2**, so this browser failure is not confirmed as pre-existing on master. Retain the
navigation failure as an intermittent observation rather than treating the original run as green.

The second whole-spec browser run also reported **1 failed, 113 passed, 32 skipped**. Save as passed;
`command-palette: Skip after adding the topic selects Service 1 without a second topic` failed at its
node-count assertion, expecting four nodes and observing three. The earlier quarantine round recorded
the same test failing with a different count mismatch; see
`docs/backlog/2026-10-25-study-quarantine-verification.md`. A focused clean-master repeat again passed
**2/2**, so this failure is not confirmed as pre-existing on master either. Investigate the count
instability separately; this round is explicitly limited to quarantine and does not change the runner.

Dispatch's solution-through-UI and Skip-all cases passed in both whole-spec browser runs. Checkout's
generated browser cases skipped through the quarantine flag. All Playwright-owned servers stopped
when their runs ended. The quarantine flag changes no golden output. The required sync regenerated
only `node/i18n/catalogs.json` from the merged English catalogs; see the release fragment for its diff.

## Verification after the required sync

After rebasing onto `92e483ff55087b5cb18ebc30597c12b74f8032bc`, the requested `src/tutorials` scope
reported **1 failed, 2,030 passed, 133 skipped** across 18 files. The only failure was the same
backoff-budget sweep timeout reproduced twice on clean master above; the publication assertions passed.

The complete production-build Chromium run of `tests/e2e/tutorials.spec.ts` passed: **127 passed,
20 skipped, 0 failed**. Both Dispatch solution and Skip-all cases passed; Checkout's generated cases
remained quarantined. The earlier browser failures did not recur in this final run. Playwright
stopped its server on completion.

Filtered i18n parity after regenerating the sync conflict passed: **3 goldens, 0 changed, 0 added,
0 missing, 0 stale**. No full gate or unrelated test suite was run in this quarantine round.
