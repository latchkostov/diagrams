## Initial Linux load failures outside deadline coverage

The deadline branch's eight-worker/eight-CPU Linux neighbour sweep ran five repetitions of
147 tests. Its first repetition passed 141 and failed six existing tests; deadline, waiting-call
and Watch together tests passed. The failures were:

- `annotations.spec.ts`: delayed formatting readiness, canvas Tab visiting annotation links,
  and Markdown export measuring decoded header images.
- `drawing-basics.spec.ts`: Shift+2 zoom, dragging to pan in Live, and wheel scrolling an embed's
  host page.

These have not been classified as pre-existing. A clean checkout of `origin/master` at
`632f1604050fe78390b25519e0fbe73e347fcc7c`, inside this checkout's ignored output directory,
ran only each affected spec once with two repetitions, four Linux workers and four CPUs.
Neither spec reproduced the failures:

```text
SUMMARY: 632f1604050fe78390b25519e0fbe73e347fcc7c | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 632f1604050fe78390b25519e0fbe73e347fcc7c | unit="not run" parity="not run" e2e={"passed":40,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The branch's second through fifth complete eight-worker repetitions each passed all 147 tests.
All five repetitions passed the deadline, waiting-call and Watch together coverage. The final sweep
reported:

```text
SUMMARY: 632f1604050fe78390b25519e0fbe73e347fcc7c | unit="not run" parity="not run" e2e={"passed":729,"failed":6,"flaky":0,"skipped":0} gate_failures=1
```

Parity was also running during the first repetition. That is context, not proof of causation.
No assertion or timeout was relaxed. Further diagnosis should distinguish asset readiness and
focus/viewport races under concurrent browser work. The verification budget calls for recording
the focused clean-master result and continuing, rather than repeating full suites on master.

## Final full Linux gate: Checks card opening

The full twelve-worker/twelve-CPU Linux gate on the final implementation and gallery test inventory
passed all static checks, 12,159 unit tests (four existing skips), build/size budgets and 2,772 parity
goldens. It passed 1,806 browser tests and failed one:
`checks-simulations.spec.ts:463`, “typing is as responsive while simulations play as with none playing”.
The failure occurred in its setup: `openChecks` pressed Enter on the visible palette command, then
`checks-card` did not appear. The responsiveness comparison never ran. No deadline, example or
Watch together test failed.

```text
SUMMARY: 49a88d92d11d9d1e7dd30e0cca0449a654072bcd | unit={"passed":12159,"failed":0,"skipped":4} parity={"goldens":2772,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1806,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Only that spec was then run on clean current master, `58389f092153b416b71f49352600c3950e570606`,
twice with twelve Linux workers and twelve CPUs. Both repetitions passed:

```text
SUMMARY: 58389f092153b416b71f49352600c3950e570606 | unit="not run" parity="not run" e2e={"passed":22,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This failure remains unconfirmed; it is not labelled pre-existing. Follow up on the palette-to-Checks
mount under whole-suite load. Per the verification budget, the focused result is recorded and the
branch is pushed for CI rather than rerunning the full suite or weakening an assertion. The final
commit after the recorded full gate adds only these verification notes; implementation and tests
remain identical to the gated commit.
