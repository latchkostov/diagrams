## Flake-report accuracy and collaboration diagnostics

- CI flake reports exclude interrupted and cancelled tests while preserving actual failures logged
  before a job's cancellation. Frozen reporter evidence covers both full and truncated logs.
- Shard comparisons keep the newest complete successful attempt from a workflow even after a partial
  rerun. The report names that attempt; historical means still include all completed measurements.
- Collaboration diagnostics notify subscribers when an empty held queue expires during verification,
  so its pending-sender count clears without waiting for more traffic.

Retired lazy-surface generation pruning from #301 was already completed in #305 (`fd7e2bb9`),
including the 100-replacement regression; no further change was needed.

No parity goldens changed. This lane uses targeted unit regressions; full output parity stays with CI.
