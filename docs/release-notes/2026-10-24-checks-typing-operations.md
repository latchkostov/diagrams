## Checks typing verification

The PR #271 investigation found matching per-key rendering work on master and the lazy-surfaces
branch: ten Linux repetitions each, all passing, with median 99 component renders and three commits
in both held/running modes. Running thread CPU medians were 90.72 ms on master and 89.53 ms on the
branch. The original CI ratio failure did not reproduce. Full distributions and source-review evidence:
[checks typing investigation](../design-review/2026-10-24-checks-typing-operations.md).

The CI regression now compares operation counts: equal median renders, component renders and commits,
exactly one real worker run per running key, zero worker failures, no publication during input and no
planning work. It keeps the original 1,500-node workload, 21 matched-prefix pairs and fresh-findings
restoration. The original thread-CPU comparison and 1.5 ratio remain in `checks-typing.bench.ts`, using
the same shared workload. No speculative runtime changes or increased ratio allowance were needed.
The retired wall-clock test is removed from the known-flake ledger; the operation guard has no exemption.

No output goldens changed. This targeted fix round does not run full suites or parity.

## Mutation verification

A deliberate extra checks-result publication before each worker run failed the new render assertion:
expected 99 renders per key, received 101. The mutation was removed; it is not part of the change.

## Targeted results

After removing the mutation, the production-build count test passed three Linux repetitions with
0 failed and 0 flaky (`tests/.output/g/rPpzFqn`). The new Benchmarks test passed one native smoke run
against that E2E production bundle, CPU throttle 1, with a 1.291 ratio. Its normal Benchmarks build
and configurable CPU throttle remain owned by the benchmark harness. All Playwright servers stopped.
