## Heavy simulation tests exceed the Windows hang backstop

While verifying keyboard/touch line shaping on Node 24.22.0, the unrelated `scalingPlanner.heavy.test.ts` case "keeps each refined peak with the Capacity × it was wanted under" exceeded Vitest's 5 s whole-test timeout. The same case fails on an unchanged archive of origin/master `069291556bb345348d306ef171a4fcde7a4d8e81`, using the frozen lockfile and one Vitest worker: both targeted repetitions failed (6.95 s and 6.44 s measured test durations). Each repetition had 62 passing tests and this single failure across the three targeted files; `gateBudget.test.ts` and `sync.test.ts` passed both times.

The original whole-suite run also reported transient gate-budget and sync failures; their targeted branch rerun passed all 42 tests. Keep simulation performance work separate from line editing. Investigate the long planner fixture and its execution cost without loosening assertions or adding a timing budget.

The heavy retries no-op case for the busy-threads corpus fixture also exceeded the same hang backstop. A separate targeted clean-master two-repetition run reproduced it once (5.18 s, 11 passing tests), then passed all 12 tests. No simulation implementation or assertions were changed in the keyboard/touch branch.
