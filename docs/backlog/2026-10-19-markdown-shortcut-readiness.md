## Markdown shortcut readiness under load

Resolved upstream by `c3d15a42` (#194), included by `pnpm sync`: the annotation shortcut test
waits for `data-markdown-ready` before editing and pressing Ctrl+B. The formatting assertion is
unchanged. The original evidence below is retained for reference; no follow-up remains here.

The non-blocking-calls UI load run (Linux, eight workers/CPUs, five repetitions of the affected
specs and their neighbours) hit one failure in the first repetition of
`annotations.spec.ts:626`: Ctrl+B left `critical` unchanged instead of producing `**critical**`.
The failure log shows `annotation-editor` initially without `data-markdown-ready`; the lazy
handler became ready after the shortcut. The remaining 129 tests in that repetition passed.

A clean `origin/master` checkout at `81287ce7346e0a8a19dfb03446314577cf3ce30c`, kept inside this
worktree's ignored test output, ran only `annotations.spec.ts` twice with four Linux workers/CPUs:

```text
SUMMARY: 81287ce7346e0a8a19dfb03446314577cf3ce30c | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This did not reproduce the failure, so it is not established as a pre-existing failure. The
Markdown implementation and this assertion are unchanged by the non-blocking-calls work.
Investigate cold shortcut handling with the lazy import deliberately held, and preserve the
formatting assertion. Do not add a sleep or weaken the expected value to hide the race.
