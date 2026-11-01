## Measure renderer work without per-frame trace capture

Baseline Nightly 41253920016 fails Windows' worker-throughput assertion. A native Windows reproduction restricted to two CPUs with three Playwright workers reports one worker frame while the page advances more than 36 frames. The viewport is settled at 0.6037, above the calm tier. No zoom, sampling ratio, CPU ratio or deadline is changed.

This CPU measurement now uses the existing performanceTest fixture, already used for stress diagrams. It retains action traces and failure PNGs while disabling DOM snapshots and per-frame trace screenshots. Those captures add main-thread/compositor work to the very work being compared with the worker. The original three samples, worker-frame floor, zero-main-thread-draw assertion, animation assertion and same-run worker/fallback CPU comparison remain exact.

In matched three-repeat Windows runs on two CPUs/three workers, the original fixture passes two and fails one; the performance fixture passes all three. In a mixed large-diagram, renderer, confirmation, narration and recording cohort, worker checks change from zero of two passing to two of two passing. The latter cohort also includes one additional main-renderer identity per repeat; two independent request-verification deadline failures remain, so the complete cohort is not reported green. A worker profiler run with less contention is inconclusive and is not proof of product throughput under load.

No renderer implementation, budget, tolerance, skip, quarantine, retry or golden is changed. Final native confirmation is recorded with the round-five verification evidence.
