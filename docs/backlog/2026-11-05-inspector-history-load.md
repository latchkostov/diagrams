## Inspector throughput history under Linux load

The caching tutorial neighbour run used 12 workers and CPUs, with five repetitions
of the caching, runtime, coach, annotation, drawing, viewport, platform and Inspector
specs. Its second repetition failed `request Inspector plots successful-request
throughput`: the final history contained nine samples instead of ten. The other
four repetitions passed. All caching checks passed all five repetitions.

## Baseline comparison

The affected `inspector-live.spec.ts` alone passed twice on a clean checkout of
`origin/master` at `9cb33865770b2b89aebf9c5fc7b5146900e0bca3`, in this worktree,
using six workers and CPUs while other gates held the rest of the shared budget.
The initial twelve-worker request exited 75 without running tests. No full master
suite ran, and the feature branch and its exact edits were restored afterward.
This comparison did **not** reproduce the history failure; it is not evidence of
an identical pre-existing failure.

```text
SUMMARY: 9cb33865770b2b89aebf9c5fc7b5146900e0bca3 | unit="not run" parity="not run" e2e={"passed":52,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Investigate the fake-clock and worker-publication boundary before reading the
history's final sample. Keep the ten-sample assertion, engine behavior and budgets.
The caching batch changes neither this fixture nor the Inspector history collector.
