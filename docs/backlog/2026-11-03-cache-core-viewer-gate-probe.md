## Viewer failures observed during the cache checkpoint gate

Owner: latchkostov. The two cache checkpoint review findings are fixed and mutation-checked. Their
unit/property/agreement, size and parity gates pass. The local full browser gate remains red; the
focused probes below do not establish a pre-existing failure or a cache regression.

The implementation is `7bfdd48d8a7092fb2684dc92208a150797fd5dce`. Its full Linux gate used six
workers/CPUs, production builds, ports 6660–6664 and zero retries. All static checks, unit/heavy
tests, build/size, Docker smoke checks and parity passed. The single Chromium failure was
`viewer-bundle.spec.ts:248`, **static viewer under Forge CSP: saved simulation, height and no
persistence**: `node-a` remained hidden at the existing visibility assertion.

```text
SUMMARY: 7bfdd48d8a7092fb2684dc92208a150797fd5dce | unit={"passed":15977,"failed":0,"skipped":13} parity={"goldens":3282,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":3371,"failed":1,"flaky":0,"skipped":11} gate_failures=1
```

## Focused comparison

A clean detached copy of fetched `origin/master`, `3673242f2c8de7d14a7222291b74845913e28b50`,
inside this workspace ran only the complete viewer spec twice, with six workers/CPUs, the pinned
Linux image, production builds, ports 6680–6684 and zero retries. Both repetitions passed.

```text
SUMMARY: 3673242f2c8de7d14a7222291b74845913e28b50 | unit="not run" parity="not run" e2e={"passed":24,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The implementation then ran the same complete spec twice with the same limits and ports 6690–6694.
The Forge CSP case passed both times. The first repetition instead failed `viewer-bundle.spec.ts:97`,
**Interactive HTML: busy-thread autoscaling, readouts and a recorded replay**: `data-desired`
remained 1 after the existing 1,500 ms setup advance. The second repetition passed all 12 cases.

```text
SUMMARY: 7bfdd48d8a7092fb2684dc92208a150797fd5dce | unit="not run" parity="not run" e2e={"passed":23,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The hidden-node signature also appears in
[the earlier engine-split probe](2026-10-27-engine-split-e2e-probe.md); the autoscaling signature
appears in [the earlier viewer clock report](2026-10-28-viewer-autoscaling-clock-ci.md). Neither
earlier report proved the failures pre-existing. The viewer spec and its bundle/adapter/host-canvas
sources are unchanged from the fetched master in this cache PR.

## Other results and next evidence

The implementation's [CI run](https://github.com/latchkostov/diagrams/actions/runs/41582196992)
passes every required lane, including all six browser shards; its
[benchmark run](https://github.com/latchkostov/diagrams/actions/runs/41582197022) passes 96/96 gates.
The independent requested sweep passes all 48 seeds. Two Linux repetitions of all Live specs,
cache-core, lazy surfaces, request waiting and live Inspector cases pass 370/370 with zero flaky
cases. No assertions, test clocks, timeouts, fixture sizes or retry settings were loosened.

Keep the failed traces and investigate initial node measurement and the simulation-selection/clock
handover. These are hypotheses, not proven causes. Following the verification budget, preserve the
red full-gate result and focused comparison instead of running another full suite. Resolve any
reproducible regression before merging; these results do not justify a known-flake exemption.
