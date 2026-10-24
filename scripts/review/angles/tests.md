Angle: TESTS. Coverage gaps for important behaviour, tests that assert too little or test
implementation details, flaky patterns (timeouts, sleeps, order dependence, shared storage), Playwright
selectors not using data-testid, missing negative/edge-case tests, slow tests. Follow common.md's
targeted, budgeted test policy; never run a full suite. Recommend specific new tests (name + what they
assert). A coverage gap alone is P2; a P1 needs a demonstrated ordinary-use bug.
