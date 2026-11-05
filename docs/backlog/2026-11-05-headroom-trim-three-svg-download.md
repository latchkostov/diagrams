## Unclassified SVG download completion timeout

The post-#435 headroom trim's complete Linux gate used 12 workers, 12 CPUs, production builds,
zero retries and two complete e2e passes. The first pass passed all 3,430 cases, with 12 skipped.
The second passed 3,429, skipped 12 and failed only
`lazy-surfaces.spec.ts:174`, `live.note: image export waits for its real chunk`.

The trace shows export readiness completing, the dialog closing and the SVG download event
arriving in under a second. `download.path()` then remained pending until the whole-test
30-second backstop canceled it. This was not a held-chunk readiness assertion failure.

```text
SUMMARY: b87fb2da9abcef41c2090720e1c19d800668ba12 | unit={"passed":16534,"failed":0,"skipped":13} parity={"goldens":3358,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":6859,"failed":1,"flaky":0,"skipped":24} gate_failures=1
```

Only the failing spec was replayed twice on an immutable, tracked-only archive of post-#435
master, using the same 12-worker/12-CPU production configuration. The real worktree and HEAD
were never switched. Both passes passed:

```text
SUMMARY: 58a3a05e1eb0ed1d7110c25c745cd3abb58529ab | unit="not run" parity="not run" e2e={"passed":118,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The focused passes do not prove a pre-existing failure. Keep this timeout unclassified. Similar
full-run SVG download stalls were recorded in
[the CDN 4 investigation](2026-11-04-cdn4-full-dev-downloads.md), but that is not proof for this case.
Investigate browser download completion under whole-suite load if CI reproduces it. No timeout,
assertion, retry, quarantine, budget or reserve was changed.

The exact browser subset required by the trim brief passed both runs: 624 passed, 22 skipped,
zero failed or flaky, including both new held-renderer cases. All four benchmark bundle gates,
unit/heavy tests, production build, size, skill freshness, static checks and full parity passed.
The full gate wrote no verification stamp. Per the verification-budget instruction, record the
one-spec master replay and push rather than rerun complete suites.

Local evidence: `tests/.output/post435-full-gate.log`, `g/riiCb6U/e2/`,
`post435-live-note-trace.zip`, `post435-master-lazy.log` and `g/rN7Qp1M/`.
