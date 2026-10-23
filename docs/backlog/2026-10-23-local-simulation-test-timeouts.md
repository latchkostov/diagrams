## Local simulation test timeouts during concurrent verification

The click-connection fix's Windows verification encountered the existing five-second Vitest
hang timeout in unrelated simulation/check tests while other local verification was active:

`pnpm test --maxWorkers=2`: `Test Files 6 failed | 1014 passed (1020)`,
`Tests 9 failed | 14960 passed | 10 expected fail | 10 skipped (14989)`,
`Type Errors no errors`. All nine failures were the existing five-second timeout.

- `src/checks/examples.test.ts`: `blocking-call` checks and `retry-storm` simulation evidence.
- `src/sim/waits.sampling.test.ts`: sampled resource callers at 500 CPU-ms.
- `src/sim/scalingPlanner.test.ts`: sizing from the Capacity × in force and keeping each refined
  peak with its Capacity ×.
- `src/checks/worker.test.ts`: request-only findings and required plans reaching the caller
  with a working worker.
- `src/examples/retry-storm.test.ts`: outcome bands at seeds 1 and 7.
- `src/sim/retries.noop.test.ts`: the frozen busy-threads fixture's byte-for-byte relabeling.

An archive of clean `origin/master` (`87e75d9337fbfe61b3c5446e11ee46c4232e6e3d`), extracted
inside this worktree's ignored test output, reproduced the examples, sampling and planner timeouts. No other
worktree or branch was used. Selected specs ran with two executions per runtime test and the
same timeout, without rerunning the full master suite.

The completed examples/sampling probe reported `Test Files 2 failed | 2 passed (4)`,
`Tests 3 failed | 155 passed (158)`, and `Type Errors no errors`. The initial planner probe
also reproduced both timeouts; a later focused planner probe passed (`Test Files 2 passed (2)`,
`Tests 23 passed | 19 skipped (42)`). Its intermittent timeout remains a follow-up. The initial
archive setup lacked workspace dependency links and emitted unrelated source diagnostics;
those links were corrected for the completed probes.

The isolated clean-master worker probe passed (`Test Files 2 passed (2)`, `Tests 9 passed (9)`,
`Type Errors no errors`), so its timeout was not reproduced in isolation. Record it separately
from the confirmed master timeouts and investigate the original concurrent-run conditions.

The clean-master retry-storm probe reported `Test Files 1 failed | 1 passed (2)`,
`Tests 4 failed | 6 passed (10)`, and `Type Errors no errors`. It reproduced seed 7's timeout
and timed out at seeds 17, 42 and 99; seed 1 passed in isolation.

The clean-master retry no-op probe reproduced the busy-threads timeout:
`Test Files 1 failed | 1 passed (2)`, `Tests 1 failed | 13 passed (14)`,
`Type Errors no errors`. Seven of the original nine timeout cases were thus observed on
master; the worker case and retry-storm seed 1 passed their isolated probes.

Investigate these expensive simulation fixtures under contention separately. Keep their
behavioral assertions and deterministic simulation checks; no timeout or assertion is changed
by the connection fix.
