## Simulation fixture timeouts during browser cancellation verification

The TouchEvent cancellation fix's full Windows unit run encountered existing five-second
timeouts in unrelated simulation fixtures. A clean archive of origin/master
(`643f61b6dc94a64248c8ffd152f69bd979d9ebb4`), extracted inside this worktree's ignored test
output, reproduces the same timeout families in focused runs of the affected specs:

- `src/examples/retry-storm.test.ts`: outcome bands at seeds 1, 7, 17, 42 and 99.
- `src/sim/retries.noop.test.ts`: the frozen busy-threads fixture's byte-for-byte relabeling.
- `src/sim/waits.sampling.test.ts`: sampled resource callers at 500 CPU-ms.
- `src/checks/examples.test.ts`: blocking-call and scale-on-busy-threads checks, plus retry-storm
  and blocking-call simulation evidence. The master probe also timed out on scale-on-busy-threads
  simulation evidence.

These tests retain their assertions and original timeout. Investigate their behavior under
concurrent local verification separately; no simulation code changes with the cancellation fix.
The earlier [timeout investigation](2026-10-23-native-load-backstops.md) records the
same fixture families and their earlier master probes.

The two focused master runs reported `Tests 12 failed | 170 passed (182)` and
`Tests 11 failed | 171 passed (182)`, both with `Test Files 4 failed | 4 passed (8)` and
`Type Errors no errors`. They are focused spec results, not full-gate SUMMARY lines.

The branch's full unit run also failed the downloadable skill's ZIP size limit by one byte
(`835001` bytes against a strict `<835000` limit in `src/ai/skill/skill.test.ts`). Two focused master executions passed:
each reported `Test Files 2 passed (2)`, `Tests 41 passed | 160 skipped (201)`, and no type
errors (the count includes type tests). Renaming the internal capture token field to `owner`
and regenerating the viewer restores the unchanged ZIP budget. The focused ZIP and capture
regressions pass; no budget or assertion is loosened.

The public CPU example's identical Check/callout/planner edit case in
`src/checks/requestsWait.test.ts` also exceeded the branch run's five-second timeout.
Both focused master executions passed (`Test Files 2 passed (2)`,
`Tests 10 passed | 10 skipped (20)`, no type errors, including type tests). That timeout
also did not reproduce in isolation.

The modifier-lint policy case in `src/lib/portableModifiers.test.ts` timed out in the full
branch run, then passed twice on master (`Test Files 2 passed (2)`, `Tests 4 passed (4)`,
no type errors). Its isolated result likewise does not establish a reproducible master failure.

The busy-thread policy choice in `src/live/threadFixPlan.test.ts` also timed out in the branch
run. Both focused master executions passed (`Test Files 2 passed (2)`,
`Tests 9 passed | 7 skipped (16)`, no type errors). This remains an isolated-pass case.

The single full branch run reported `Test Files 8 failed | 1022 passed (1030)` and
`Tests 15 failed | 15137 passed | 10 expected fail | 10 skipped (15172)`, with no type errors.
Fourteen failures were the unchanged five-second timeouts; the remaining ZIP size failure
is fixed and verified separately above. No second full unit suite was run.
