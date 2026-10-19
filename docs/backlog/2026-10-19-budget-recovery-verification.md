## Existing annotation shortcut race during budget recovery verification

The second repetition of the 8-worker/8-CPU Linux Live-and-neighbours run failed only
`annotations.spec.ts:686`: Ctrl+B left `critical` instead of `**critical**`. The first and third
repetitions passed all 180 cases. This is the identical failure already reproduced twice on clean
master at higher load in [the annotation keyboard investigation](2026-10-18-annotation-keyboard-load-races.md).
No annotation implementation or assertion is changed by this recovery fix.

The annotation spec alone was checked once, with two repetitions, on a clean copy of current
origin/master inside this worktree. Four workers/four CPUs fit alongside the ongoing eight-worker
run; this lower-load probe passed:

```text
SUMMARY: 438e4819d8b2d44efbefe0e674aef7e22beddc02 | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The earlier clean-master reproduction remains the evidence that the formatting race predates this
branch. This probe does not claim to reproduce it at the current run's eight-worker load. Keep the
first-key assertion and fix the lazy formatting handoff independently; do not add a readiness wait
or relax the assertion here.
