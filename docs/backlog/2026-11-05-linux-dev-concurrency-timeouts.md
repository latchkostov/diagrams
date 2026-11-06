## Linux Dev concurrency timeouts

The complete cache-aside Dev run on `3533613fb8084cb196528d4d4aa720509fa69ed6`
used 12 test workers and 12 CPUs. It completed with 3,372 passed, 19 failed,
zero flaky and 56 skipped cases. No assertion or timeout was changed.

Only its 16 failing spec files were repeated twice on clean master
`85bc26c10b4480177568cf98a9812e683225c7fd`, in a committed-source Linux volume
with the same Dev target and 12-worker/12-CPU allocation. The bounded comparison
completed with 617 passed, 15 failed, zero flaky and two skipped cases:

```text
SUMMARY: 85bc26c10b4480177568cf98a9812e683225c7fd | unit="not run" parity="not run" e2e={"passed":617,"failed":15,"flaky":0,"skipped":2} gate_failures=2
```

Eight distinct feature-run failures reproduced on master: the skill ZIP download
in `ai-howto`, isolated-editor edits in `collab-c1a`, all three narrated-subject
insets in `keep-camera`, phone overflow Retry in `trim-first-view`, the
`study-fanout` keyboard solution, and the syllabus finish/reset walkthrough.
Master also timed out in a separate collaboration paste case. These results
do not prove that the other eleven feature-run failures predate the change.

Reports are `tests/.output/g/r7RyEZR` for the feature run and
`tests/.output/cdn5-master-baseline/tests/.output/g/rFKybOQ` for the bounded
comparison. The Inspector/cache-aside load run independently passed all five
repeats: 1,110 passed, zero failed and zero flaky, with six workers and six CPUs
(`tests/.output/g/rklznhn`).

## Complete Dev follow-up

The complete feature Dev rerun used six test workers and the same total
12-CPU allocation, leaving more capacity for the Vite compiler and browsers.
All assertions, timeouts and product limits remain unchanged.

It passed all 3,391 runnable cases, with zero failures, zero flaky cases and
56 skips, in 3,008.9 seconds. All nineteen earlier failed cases passed; no code
or test changed between the two feature runs. Report: `tests/.output/g/rKB2bTc`.

```text
SUMMARY: 3533613fb8084cb196528d4d4aa720509fa69ed6 | unit="not run" parity="not run" e2e={"passed":3391,"failed":0,"flaky":0,"skipped":56} gate_failures=0
```

## Follow-up

Investigate Dev concurrency failures without increasing test timeouts. Preserve
the separate fake-clock Live and compiler-load evidence, and do not label an
unreproduced failure as pre-existing.
