## Existing backoff-budget tutorial timeout under load

The engine-split PR's ordinary `pnpm test --maxWorkers 2` run timed out in
`src/tutorials/completionSweep.test.ts`, test
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`.

Reproduced only that test twice on a clean checkout of `origin/master` at
`a2506160a5177ec55ab46a5a44b937ac9d695303`, inside this workspace's ignored test output directory, using the
same Node 24.22.0 and dependencies. The first run failed with the identical `Test timed out in 5000ms` error;
the second passed. Each run selected one test and skipped the other 1,733. No clean-master full suite was run.

The extraction's focused replay, lineage, latency and partial-dot tests passed, and its moved-body comparison
preserves the tick and simulation expressions. Keep this tutorial flake separate from the pure engine move;
investigate its work and whole-test hang backstop under contention without weakening behavior assertions.
