## Linux failures: distinguish focus ownership from elapsed playback

The original application and tests run in the Linux container with six workers sharing four CPUs,
`--repeat-each 30`, zero retries. The generated Continue row selects all ten tutorials, supplying parallel
load along with the original collaboration Lab case: **330 passed, zero failed or flaky**. Both named
cases therefore record **0/30 failures**, as does export-for-audience Continue. This does not reproduce
their CI failure rate.

An additional cohort selects the two named cases, thirty repetitions each, with eight workers sharing
two CPUs. Study-rag records **0/30 failures** again. The Lab records **14/30 overall test-limit failures**
later in its two-viewport checks, after the resizer assertion passes; 46 executions pass, with zero
flakes. These failures are distinct from the reported 372 px resizer failure. No timeout or assertion
is changed to accommodate this deliberately oversubscribed cohort.

The twelve-worker request preceding that cohort expires with the shared budget's busy code 75 while
another checkout holds four slots. No checks run in that request, and no live lock is removed.

## Product repair: a name retry reclaims another control's focus

The original CI trace for `collab-c0.spec.ts:259` ends with Label active, even though the driver focused
the resizer and sent End. The name handoff has already released its type-ahead buffer, but leaves a
one-frame retry to repair focus returned by a closing menu. Moving focus to another control does not
cancel that retry, so it can take the key between the driver's focus and key delivery. The same rule
affects assistive navigation that moves focus programmatically.

The repair retires that retry when focus explicitly arrives outside the canvas, excluding focus the
controller is currently moving itself. The existing menu-return-to-canvas retry stays intact.

The new Inspector browser regression holds the real handoff on its fake frame clock, focuses the
resizer, then releases the frame before sending End. In Linux, six workers / four CPUs, the original
app fails **30/30**, all at the focused-resizer assertion, with its width still 372 px and valid maximum
960 px. This holds for both an initial routing-fixture variant and the final variant using the original
case's public example. The final test waits for Label itself instead of depending on unrelated routing
fields. The deterministic controller regression fails for the same focus return when the repair is
temporarily reverted. The original collaboration test and its width assertion remain unchanged.

## Test repair: drive the reference replay on authored time

CI [41390766194, first attempt, E2E 6/6](https://github.com/latchkostov/diagrams/actions/runs/41390766194/attempts/1)
fails study-rag at `survive-reindex` in `skipAll`. The trace shows both Skip clicks arriving and the
reference replay running; its final snapshot is already `finished` immediately after the failed
assertion. Continue reconstructed the real predecessor. The completion observation is not lost.

The test resumes wall time before that final replay, which requires at least six seconds of simulation
time inside an ordinary seven-second assertion backstop. Keep the already-paused Playwright clock and
use `skipAll(page, true)`, which drives fixed simulation ticks and waits for the runner's actual next
milestone. No application transition, assertion deadline, tolerance or expected predecessor is changed.

The two local original-application cohorts above record **0/60** study-rag failures, so they do not
establish an empirical browser improvement. The recorded CI failure supplies the causal evidence;
report the local before/after observations without claiming that a zero before rate proves elimination.
Production-build export-for-audience Continue also records zero console errors in its first thirty
repetitions. The full development run below also records no console errors in its export cases; the
reported transient flushSync diagnostic is not reproduced locally.

The scheduled Windows baseline's study-rag failure is earlier: the initial demonstration, before reload
or Continue. Its trace spends the assertion polling fake ticks while Go live is pressed but the live
controls have not mounted; the Inspector also still shows Loading. Keep that cold-session readiness
failure separate from the post-Continue replay above. The existing `waitForLiveSession` signal is the
candidate for a focused driver regression; the clock correction here does not claim to repair that
distinct baseline failure.

## Additional development diagnostics

A cold development-server cohort runs the original Lab case, study-rag and export Continue, the focused
Inspector regression and annotation persistence twice each, six workers / four CPUs. It records five
passes and five failures: one missing routing table during the initial regression setup, two annotation
overall limits, one Lab overall limit, and one export Continue failure while finishing the initial SVG,
before reconstruction. The failed export trace contains no flushSync error. These are recorded as
diagnostic failures, not counted as a passing Dev gate.

The routing dependency is removed from the new regression's setup as described above, without changing
the focused-handle or exact maximum-width assertions, any existing test, or any deadline.

A proposed badge-viewport change is rejected. A synthetic lifecycle test produces the flushSync warning,
but the actual badge loader registers through an asynchronous import continuation rather than that
layout path. That experiment does not establish the reported tutorial bug, and removing the flush could
change publication ordering. Neither its source change nor its synthetic test is retained. Obtain a
real tutorial call stack before changing capture ordering.

The subsequent full affected tutorial spec, original Lab case, final public-example focus regression and
annotation persistence case run twice each on the actual Vite development server, three workers / four
CPUs. **All 52 executions pass**, with zero failures, flakes or skips. Export Continue runs twice with
its real SVG/PNG/HTML paths and the existing empty-console assertion intact. This is the passing Dev
verification; the earlier cold stress failures remain recorded above.

```text
SUMMARY: d0ac286b3dec45c363e0d0c1cb749b65a0eafb9b | unit="not run" parity="not run" e2e={"passed":52,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Final production observations

The final public-example regression and accepted application source run thirty times per case in Linux,
six workers sharing four CPUs. All 120 executions pass, with zero failures, flakes or skips.

| Case                         |                            Original failures | Final failures |
| ---------------------------- | -------------------------------------------: | -------------: |
| Controlled Inspector handoff |                                        30/30 |           0/30 |
| Original collaboration Lab   |                                         0/30 |           0/30 |
| Study-rag Continue           | 0/30 (also 0/30 at eight workers / two CPUs) |           0/30 |
| Export-for-audience Continue |                                         0/30 |           0/30 |

The controlled case supplies a reproducible before/after repair. The zero original rates for the other
rows are retained honestly; a zero-to-zero rerun is not evidence of eliminating a measured flake rate.
The CI trace explains the study-rag clock correction independently.

The accepted product code also passes all 142 targeted unit cases, including 30 startup/reserve heavy
tests, production build, size, and full parity: **3,178 goldens, zero changed, added, missing or stale**.
The final source passes five fragment checks. No golden is recorded or changed.

These quick gates compile working edits on starting HEAD d0ac286b3; the SHA below is not claimed to be
a clean committed-head verification stamp.

```text
SUMMARY: d0ac286b3dec45c363e0d0c1cb749b65a0eafb9b | unit={"passed":142,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":120,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: d0ac286b3dec45c363e0d0c1cb749b65a0eafb9b | unit={"passed":5,"failed":0,"skipped":0} parity="not run" e2e={"passed":120,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The affected specs and timing-sensitive neighbours (annotations, drawing, polish, viewport, platform,
Inspector and collaboration) then run five times with eight workers sharing six Linux CPUs. Every
pass completes all 231 cases: **1,155 passed, zero failed, flaky or skipped**.

```text
SUMMARY: d0ac286b3dec45c363e0d0c1cb749b65a0eafb9b | unit={"passed":5,"failed":0,"skipped":0} parity="not run" e2e={"passed":1155,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
