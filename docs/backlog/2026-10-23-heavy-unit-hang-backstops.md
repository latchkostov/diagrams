## Heavy simulation unit tests exceed local hang backstops

Observed while verifying the resilience/hover-card follow-up on Node 24.22.0, Vitest 5.0.4, Windows. The full unit run with four workers recorded five 5-second timeout failures in `src/checks/examples.test.ts`, `src/sim/scalingPlanner.test.ts` and `src/sim/retries.noop.test.ts`. Its separate sparkline assertion mismatch was the intentional addition of bidi isolation marks and is fixed in this branch.

Only the affected specs were checked on clean tracked sources exported from `origin/master` (`78be9ef4`) into an ignored directory inside the same workspace; no other worktree was used. Two one-worker runs of the examples and scaling-planner files produced:

- Run 1: `Test Files 2 failed | 2 passed (4)`; `Tests 2 failed | 144 passed (146)`. The `checks on the public examples > blocking-call` and `keeps each refined peak with the Capacity × it was wanted under` cases timed out at the existing 5-second hang backstop.
- Run 2: `Test Files 1 failed | 3 passed (4)`; `Tests 1 failed | 145 passed (146)`. The same refined-peak case timed out again. Every functional assertion passed.

The retry-noop case passed twice on clean master. On the feature branch, the first scaling-planner case and retry-noop file passed the isolated default-config recheck; the retry-storm evidence case passed a further isolated default-config check. All four affected files, including the corrected sparkline assertion, passed with the repository's existing CI configuration: `8 passed` files, `162 passed` tests. No assertion, fixture, or timeout setting was weakened or changed.

Follow up on the deterministic work done by the heavy checks/planner fixtures so their usual local backstop is reliable under contention. Preserve their semantic comparisons and test meaningful work counts; do not simply re-record outputs or raise a timing assertion to hide the cost.
