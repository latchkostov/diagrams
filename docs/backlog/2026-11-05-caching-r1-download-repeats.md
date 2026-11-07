## Caching fix-round download investigation

The three affected specs from the earlier
[complete-gate timeout report](2026-11-05-download-timeouts-full-gate.md) ran
five times on caching fix commit `18b63fe659f43d407759e1ec67c51e6637571277`,
in Linux with six workers and six CPUs. Each repetition passed all 51 checks:
255 passed, zero failed, zero flaky and zero skipped. No timeout or assertion
was changed.

```text
pnpm gate quick tests/e2e/review-358.spec.ts tests/e2e/trim-first-view.spec.ts tests/e2e/tutorials-apply-present.spec.ts --linux --only e2e --repeat 5 --workers 6 --cpus 6 --ports 6700 --max-wait 1

SUMMARY: 18b63fe659f43d407759e1ec67c51e6637571277 | unit="not run" parity="not run" e2e={"passed":255,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Assessment and remaining uncertainty

The earlier clean-master comparison passed these same specs twice. The five
head repetitions now also pass, so this workload does not demonstrate a
head-only regression or caching runtime leakage. Lesson module initialization
constructs example, selector and repair data; the fixes add no background
runtime, server or shared browser resource.

Focused repeats do not explain the earlier timeouts during the complete suite
or establish that they were identical pre-existing failures. Retain the original
evidence and investigate browser download completion if a complete run
reproduces them. The final complete Linux gate is reported separately in the
fix-round handoff.
