## Playback deadlines under constrained Linux CPU

The P2 rate/rule/readout batch's exploratory Linux load run used four browser workers with a two-CPU cap.
Its first repetition had 12 passes and three test-deadline failures: the light/dark recovered-breaker cases
in `health-current.spec.ts` and the existing rate-edit playback case in `inline-edit.spec.ts`.
The five-repeat run was stopped after this failure rather than finishing redundant repetitions.

Checked clean `origin/master` at `76253429898cf77c4631a10bcf0afc4fbb1eb879` in the same worktree,
with no tracked or untracked changes. Ran only `health-current.spec.ts` and `inline-edit.spec.ts`, twice,
with the same four workers and two-CPU cap. Both recovered-breaker cases exceeded the unchanged test
deadline in both repetitions; their final action varied as the deadline expired. Rate-edit playback passed
both times, so its initial branch timeout is not classified as a reproduced master failure.

```text
SUMMARY: 76253429898cf77c4631a10bcf0afc4fbb1eb879 | unit="not run" parity="not run" e2e={"passed":16,"failed":4,"flaky":0,"skipped":0} gate_failures=2
```

Evidence: `tests/.output/g/r3msMD2/e1/` (initial branch run),
`tests/.output/g/r1pP18L/e1/` and `e2/` (clean master), including checkpoints and Playwright traces.
Follow up on fake-clock playback cost under CPU contention without increasing deadlines or weakening
assertions. The batch leaves the simulation runtime unchanged.
