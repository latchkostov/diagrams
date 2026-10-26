## Existing queue-decoration replay timeout under load

The engine-split PR's ordinary `pnpm test --maxWorkers 2` run timed out in
`src/live/decorations.test.ts`, test
`preserves continuous queue attention on paused seeks and checkpoint restores: three-quick-retries`.

Ran only that test twice on a clean checkout of `origin/master` at
`a2506160a5177ec55ab46a5a44b937ac9d695303`, inside this workspace's ignored test output directory, using the
same Node 24.22.0 and dependencies. Both runs failed with the identical `Test timed out in 5000ms` error;
each selected one test and skipped the other ten. No clean-master full suite was run.

Keep the test's behavioral assertions unchanged. Investigate its replay workload and whole-test hang backstop
under contention independently of the pure engine extraction.
