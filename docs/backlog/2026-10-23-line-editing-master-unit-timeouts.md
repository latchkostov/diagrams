## Native unit timeouts while finishing line editing

The full native unit run on `d72409dff5c0dfc95cc73ed3d52675d9aa83dbc3`
(`pnpm test --maxWorkers 6`, Node 24.22.0) finished with 14,953 passed,
seven failed, ten expected failures and ten skips, with no type errors.
Every failure reached the existing five-second test backstop:

- `src/checks/examples.test.ts`: blocking-call checks, retry-storm evidence,
  and blocking-call evidence (three).
- `src/sim/scalingPlanner.test.ts`: capacity-at-decision sizing and refined
  peaks under their original capacity (two).
- `src/sim/waits.sampling.test.ts`: sampled caller CPU residence at 500 CPU-ms (one).
- `src/sim/retries.noop.test.ts`: busy-thread fixture relabelling (one).

Only these four specs were run twice against a clean `git archive origin/master`
at `4bdf5af7bf6653aad28deffca6c8601106aecaf3`, inside this checkout's ignored
outputs, sharing the installed dependencies and using the same Node and six
workers. The installed Vitest CLI was launched directly from the archive:

```sh
node node_modules/vitest/vitest.mjs run src/checks/examples.test.ts src/sim/scalingPlanner.test.ts src/sim/waits.sampling.test.ts src/sim/retries.noop.test.ts --maxWorkers 6
```

Round one: six failed, 208 passed; it reproduced every failure except sampled
CPU residence. Round two: seven failed, 207 passed; all seven original test
names and timeout errors reproduced. Both runs had no type errors. No full
suite was run on master. `src/checks/` and `src/sim/` have no diff between this
branch and that master commit.

Local evidence: `tests/.output/edges-252-unit.log` and
`tests/.output/edges-master-units-{1,2}.log`. The clean archive is under
`tests/.output/edges-master-baseline/`; no other worktree was changed.

## Follow-up

Continue the existing native unit load investigation from
[the earlier line-editing run](2026-10-23-edge-review-unit-load.md) and
[the hover-card run](2026-10-23-native-unit-timeouts.md). Keep this separate from
line editing: no behavior assertion, timeout, retry or bundle budget was relaxed,
and no output golden was re-recorded.
