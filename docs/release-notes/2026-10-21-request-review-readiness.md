## Request checks: readiness, timing and bounded verification

Agent checks now wait for request findings for the exact diagram content. Pending or failed checks cannot
be reported as clean. Workers and the local fallback publish complete findings to one shared result store,
including disabled rules, so displayed fixes remain actionable when workers are unavailable.

Timeout Checks and live advice share the callee's selected endpoint latency, API or model latency,
downstream waiting and round-trip network delay. No timeout is offered when a normal response cannot fit
the caller's thread budget. Free-play verification inputs are built once, lazily, only after admission to
the same work budget used by live fix verification.

Keyboard focus survives alternative fixes that remove several findings. Blocking cycles remain marked
as potentially deadlocked when unrelated non-blocking calls belong to the same request component.

## Output parity

No additional goldens changed beyond the existing 329-golden feature inventory. All 2,869 goldens match,
with zero additions, missing files or stale files. Bundle budgets are unchanged; entry gzip is 108.7 kB
against the existing 123.5 kB limit.

## Review verification

The targeted 81 unit/type checks and 21 browser cases passed three times. Temporarily reverting the
readiness, fallback cache, endpoint estimates, replay preparation, cycle and focus fixes reproduced the
regressions. The broader quick-gate unit set passed 13,698 checks with eight skips.

[PR CI for the reviewed head](https://github.com/latchkostov/diagrams/actions/runs/39695531260) passed all
six browser shards. Neither the download round trip nor the slow-motion transition failed there; this
does not establish a master regression. Initial local verification exposed a new test's missing number
separator and asset 404s caused by overlapping build outputs; the corrected stable-bundle run passed.
The initial Linux load pass also exhausted one test's overall timeout after its correct timeout toast;
the same diagnosis, persistence and Undo assertions now run after the first complete 11-second window
instead of 15 seconds of virtual replay. No assertion or test timeout was relaxed.
