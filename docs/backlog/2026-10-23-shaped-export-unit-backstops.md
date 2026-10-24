## Unrelated simulation and checks backstops

The shaped-dependency export fix's native unit run hit existing five-second backstops in scalingPlanner (two refined-peak cases), retries.noop (w1-busy-threads), and public-example checks (blocking-call checks, retry-storm evidence, blocking-call evidence). No assertions or backstops were changed.

Only those cases were replayed twice against clean origin/master `2861c6e7895328f9ea674a781e6566b2ea160eaf`, using an isolated source snapshot under this worktree's ignored test output and the same installed dependencies. Both repetitions reported `Test Files 2 failed | 4 passed (6); Tests 3 failed | 40 passed | 117 skipped (160); Type Errors no errors`. Both reproduced retries.noop's w1-busy-threads, blocking-call checks, and retry-storm evidence timeouts. Follow up their work separately from edge export readiness.

The other three cases passed on master and on a focused branch rerun (`Test Files 4 passed; Tests 37 passed | 109 skipped; Type Errors no errors`). Their initial failures are load observations, not proven pre-existing failures. The export regression itself failed on the unfixed production build (missing dependency glyph), then all twelve edge-route cases passed twice on Linux after the fix. All 3,146 parity goldens are unchanged.
