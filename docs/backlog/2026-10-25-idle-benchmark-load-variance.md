## Idle-step benchmark variance under concurrent verification

During checkpoint-boundary verification, the focused simulation benchmark run failed only
`a tick with nothing moving grows at most linearly`: `idleTick` measured 25.6531x for eight times
the input against the unchanged 24x limit. Four other gating tests passed. The run overlapped a
three-job property sweep and output-parity work.

The exact failing case passed twice in a clean archive of origin/master `31aa4f4b5`, and twice
on the checkpoint branch when selected by itself. This does not prove that the loaded failure
reproduces on master, nor establish a checkpoint regression. The engine tick body is unchanged;
no timing assertion, sampling count or benchmark limit was loosened.

Follow up on resource admission for standalone Node benchmarks and the idle-step measurement's
sensitivity to contention. Retain the eightfold input ratio and 24x bound. Use isolated same-run
comparisons; avoid another broad suite solely to reproduce this diagnostic failure.
