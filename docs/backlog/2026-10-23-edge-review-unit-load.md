## Unit hang backstops during the line-editing review

A raw `pnpm test --maxWorkers=4` run alongside browser verification finished with 14,362 passed,
7 failed, 10 expected failures and 10 skipped. Every failure hit the existing five-second hang
backstop: sampled waits (one), retry no-op parity (one), scaling planner (two), and public-example
checks/evidence (three). Type checking passed.

Only those four specs were run twice in an untouched `origin/master` archive at
`d614cf7aec4d7ec4ebb45a794d5d14b223ba5ec7`, inside this checkout's ignored outputs, using the same
installed Vitest and dependencies. The runs finished with 206 passed / 6 failed and
209 passed / 3 failed. The first reproduced the same waits, retry no-op, scaling and blocking-call
backstops. The retry-storm evidence backstop did not reproduce in these two runs. No full suite was
run on master. All four specs pass on the branch in the gate's documented CI environment:
212 passed, no type errors. The quick gate also passes all 1,730 related unit tests.

This extends the existing backstop follow-up with current-master evidence. Investigate expensive
simulation setup and resource accounting without weakening behavior assertions, adding retries,
or changing hang backstops as part of the line-editing fixes.
