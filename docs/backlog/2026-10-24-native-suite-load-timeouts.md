## Native full-suite timeouts under host load

During shaped-line interop verification on Windows/Node 24.22.0, the full native unit run hit test
backstops in `src/lib/sync.test.ts` (reloads upstream policy, conflicted output true),
`src/checks/requestsWait.test.ts` (public CPU example primary edits), and
`src/live/threadFixPlan.test.ts` (verified busy-thread policy). No assertions or timeouts were changed.

Focused checks of all three specs on an untouched origin/master snapshot at
`069291556bb345348d306ef171a4fcde7a4d8e81` passed twice: sync/requestsWait 26 tests each run,
and threadFixPlan 8 tests each run. The branch's focused run then passed all 34 tests. These probes
do not reproduce the full-run timeouts, so this is not a claim of a proven master failure. Investigate
scheduling/host-load sensitivity if it recurs in CI; keep substantive assertions intact.
