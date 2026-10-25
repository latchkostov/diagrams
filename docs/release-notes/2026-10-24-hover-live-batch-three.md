## Hover and Live cards: batch 3

Idle workers, including workers at zero replicas or waking with queued demand, no longer report exhausted threads when no threads are occupied. Saturated working or waiting threads still report exhaustion. This applies the current-conditions health semantics shipped in #287.

Regressions now check history cadence before its ten-sample cap, changing values during stable card geometry, committed forward and backward keyboard seeks, tuned resilience settings across reselecting the active control and Undo, and successful throughput independently of requests and attempts.

Resilience reselection uses the existing shared segmented-control guard; no new toggle policy or health policy was added. No parity goldens changed.
