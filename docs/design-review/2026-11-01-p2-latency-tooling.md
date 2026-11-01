## Scope and UX review

This batch changes tests and benchmark tooling only. It adds no control, wording, layout or engine
behavior. The latency driver preserves pointer pinning, exact scroll boundaries, keyboard scrolling
and focus-return assertions. Simulation coverage intentionally retains the pointer-away naming
interleaving that the stabilized general driver no longer exercises.

## Latency evidence

The historical failure is [#404 run 41199788642, attempt 2](https://github.com/latchkostov/diagrams/actions/runs/41199788642/attempts/2).
The downloaded trace shows viewport y changing from -419.694 to -371 after node focus, while the
camera-idle assertion was before that focus. The card stays at top 72 during the last part of the pan,
then changes to 141 across the header click. Pin readiness remains false and the camera marker still
reads idle during the pan. Waiting on both post-focus camera readiness and viewport settlement
addresses this missing boundary without changing click behavior or widening a timeout.

Original master, Linux six workers/three CPUs, `--repeat-each 30`: presentation **0/30 failures**,
embed **0/30 failures**. The controlled stationary-card/moving-viewport regression fails **3/3** with
the waits absent and passes **3/3** with them. Keeping only camera idle still fails the untracked
viewport case. No natural before/after reduction is claimed.

## Negative controls

- Replacing the median with a mean, or removing numeric sorting, fails the skewed-sample comparison.
- Removing `await` from observer clearing fails the held-clearing assertion before GC.
- Retaining a palette index instead of command identity fails after source reordering.
- Hard-coding the native shard fails the workflow binding assertion.
- Restoring the artwork `/assets/`-only filter fails on the dev server with zero counted downloads.
- Removing both post-focus waits fails all three controlled cases: pinning wins the race.
- Keeping only camera idle fails the changing-viewport case, where the marker is already idle.
- Preventing Simulation's normal pointer focus handoff fails the focused-name assertion.

## Verification

Targeted units: **62 passed** (including fragment and comparison-workflow checks). Survey comparator: **27 passed**. Reserve/startup heavy tests:
**30 passed**. Production build and `pnpm size` pass with all existing limits.
Full parity: **3,178 unchanged goldens**, including **1,873 node cases** and **110 Linux browser cases**.
The first Linux editor/artwork cohort passes **40/40**, two repetitions, zero retries.
The broader final Linux cohort passes **214/214** at four workers/four CPUs with two repetitions:
**212 Chromium and 2 dev**, no failed, flaky or skipped tests. It covers all latency cases and the
new readiness fixture, editor/naming, stencil artwork, hover cards and Live Inspector neighbours.

An intermediate camera-wait-only latency cohort passes **120/120** at six workers/three CPUs.
The final driver additionally waits for viewport settlement because the historical trace and the
third controlled regression show that the camera marker alone is insufficient.

Final source, six workers/three CPUs, `--repeat-each 30`: **60/60 passed**, presentation **0/30 failures**
and embed **0/30 failures**, zero flaky or skipped. The original matched baseline was also **0/30**
per surface. The deterministic control improves from **3/3 failing to 0/3 failing**; a natural-rate
reduction is not established by these samples.

A subsequent six-worker/two-CPU mixed stress attempt hits the unchanged artwork visible-image
readiness predicate twice. It is interrupted rather than reported green. Its checkpoint and traces
remain in `tests/.output/g/rGJHvVn`; it produces no SUMMARY because the container was stopped.
This is separate from the demonstrated dev URL-counting gap and latency pinning failure.
The [separate follow-up](../backlog/2026-11-01-artwork-readiness-under-load.md) records a fresh master
source export and frozen install reproducing **both artwork failures** at the identical predicate.
The four parallel latency executions pass. Its exact SUMMARY is **4 passed, 2 failed, 0 flaky**;
the unchanged master failure is deferred, without weakening an assertion or increasing a timeout.

Final scoped SUMMARY lines (quick gates identify the starting HEAD and test working changes):

```text
SUMMARY: bdbce520e93460976997e59144070912ce8131c4 | unit="not run" parity="not run" e2e={"passed":214,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: bdbce520e93460976997e59144070912ce8131c4 | unit="not run" parity="not run" e2e={"passed":60,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Regeneration reports no generated changes, and i18n reports zero errors with its existing translation
gaps/warnings. An early lint pass catches six non-null assertions in the new fixture; explicit fixture
checks replace them. Final static results accompany the PR.
