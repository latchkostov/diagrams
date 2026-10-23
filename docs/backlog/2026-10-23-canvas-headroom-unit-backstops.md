## Native simulation test backstops under concurrent load

The canvas-headroom native unit run hit five-second test backstops in public-example checks
(`blocking-call`), public-example simulation evidence (`retry-storm`, `blocking-call`), sampled
resource residence (500 CPU-ms), retry W2-noop busy-thread relabeling and two scaling-planner
cases. Assertions and timeouts were left unchanged.

The first four reproduce on a clean archive of origin/master `d0c3f96d` inside this worktree,
with the same installed dependencies and two workers, each test run twice (`--repeats 1`):
4 failed, 154 passed; no type errors. Retry W2-noop also reproduces twice (1 failed,
2 passed, 11 skipped). The two focused scaling cases initially pass on clean master,
but repeating the whole spec reproduces the refined-peak timeout seen in the final targeted
run. That repeated clean-master spec reports 4 failed, 38 passed: one timeout and three
instrumentation assertions affected by cache reuse between repeats. The other original
scaling timeout passes in the final targeted run. There are no type errors. Diagnostic logs
are ignored under `tests/.output/headroom-master-*.log`.

The long unit run also overlapped the required rebase and subsequent edits, so transient
translation/import/build errors from that run are not final validation. Only affected files
were rerun after the source settled, avoiding another full suite. Follow up on the native
hang-backstop workload independently; do not relax semantic assertions.
