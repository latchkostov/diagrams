## Vendor CI follow-up: existing simulation backstops (2026-10-23)

The search-ranking correction's ordinary `pnpm test --maxWorkers=2` run encountered the same six
five-second simulation backstops already recorded before this fix in
[the existing investigation](2026-10-23-simulation-test-backstops.md): two `blocking-call` checks/evidence
cases, two scaling-planner cases, one sampled-resource caller case and the `w1-busy-threads` retry case.
No assertion, timeout or retry setting was changed.

## Clean-master evidence

Only the affected cases were run in an archived clean `origin/master` tree at
`d614cf7aec4d7ec4ebb45a794d5d14b223ba5ec7`, inside this checkout's ignored output directory, using
Node 24.22.0 and the same installed dependencies. No other worktree or branch was changed.

Two targeted runs of checks/examples, scalingPlanner and waits.sampling reported respectively
`1 failed | 60 passed | 137 skipped` and `2 failed | 59 passed | 137 skipped`, with no type errors.
The ordinary checks `blocking-call` case hit its existing five-second backstop in both runs; sampled
callers hit it in the second. Evidence and both scaling cases passed in isolation. Two targeted retry
runs each reported `1 failed | 2 passed | 11 skipped`, with no type errors: `w1-busy-threads` hit the
same five-second backstop on clean master both times.

This confirms the existing load sensitivity; it does not claim that every case fails consistently on
master. Keep the outcome assertions and investigate avoidable work or operation-count checks under
`docs/QUALITY.md`, without increasing wall-clock limits. The full ordinary suite was run once only.
