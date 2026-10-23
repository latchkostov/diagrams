## Default unit-test backstops under concurrent browser load

A raw `pnpm test --maxWorkers=2` run during Linux browser repetition hit the existing five-second
hang backstop in simulation, showcase, planning, geometry and relay tests. It finished with 14,260
passed and 17 failed; one failure was the edge inspector's SSR harness, corrected in the gesture PR
to render its newly lazy panel directly while retaining the same assertions.

An untouched archive of origin/master at `5f47cc876f6c7a37046b3efe71653ca38fe25a6e`, inside this
checkout's ignored test output, ran only the affected specs twice. Its first repetition had 329
passed, 3 failed and 2 skipped; the second had 324 passed, 8 failed and 2 skipped. Both reproduced
the checks and scaling-planner backstops; the second also reproduced sampled-wait backstops.
The commit was verified from the archive's Git header. No full suite was run on master. The normal
gate already uses the documented CI hang backstop.

Audit the remaining expensive tests' setup and resource accounting without adding elapsed-time
assertions or weakening their behavior checks. Keep the original failure logs in the task outputs
when investigating; not every case from the loaded raw run reproduced in the two master runs.
