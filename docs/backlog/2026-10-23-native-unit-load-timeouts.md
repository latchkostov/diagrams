## Native unit hang backstops under load

The Windows `pnpm test --maxWorkers=4` run on 2026-10-23 completed with 14,847
passing tests and eight 5-second hang-backstop failures across five files:
`src/checks/examples.test.ts` (simulation evidence for retry-storm and blocking-call),
`src/examples/retry-storm.test.ts` (seeds 17, 42 and 99),
`src/sim/retries.noop.test.ts` (the w2-noop relabel case),
`src/sim/scalingPlanner.test.ts` (refined peaks), and
`src/sim/waits.sampling.test.ts` (sampled resource callers).

An isolated archive of clean `origin/master` at
`6637eecf42cf9751f8b9834a47f01571d120ee81`, inside this checkout's ignored test-output
directory, replayed only these five specs twice. It reproduced the same timeout in
both public-example evidence cases, the no-op relabel, refined peaks and resource
callers. The three retry-storm seeds passed in isolation. The planner replay also
reported additional assertions when using Vitest's in-process `--repeats=1`.

Investigate the native default backstop separately from the CI environment's larger
hang backstop; preserve outcome and complexity assertions. The CI-flake changes do
not modify these tests or their runtime implementation. No full clean-master suite
was run.
