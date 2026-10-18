## Checks typing CPU ratio

Nightly 39115946465, Build ×3 shard 3/6, failed
`checks-ui.spec.ts:313`: running median 0.180236 CPU seconds versus held median
0.114612, above the unchanged 1.5 ratio. Two targeted Linux runs at 3 CPUs,
7 GB and three workers did not reproduce it. The test is `test.fixme` under the
two-round triage rule; its assertions, worker requirement, workload, sampling and
1.5 ratio remain intact.

Investigate the main-thread work of copying/posting the diagram, publishing stale
findings and receiving results, and distinguish it from concurrent idle module
evaluation. Keep same-page paired baselines and prove the final test still rejects
running the checks engine on the main thread. Do not raise the ratio or replace it
with a wall-clock budget. Remove the `fixme` with that evidence.
