## Blocking pool admission at fractional scale — resolved

Resolved in PR #222's review round. Pool acquisitions now carry the thread admission phase's fractional time, and due residence/pool releases precede successor thread admission. The original regression is a passing `it` with its unchanged assertion and bound.

Over 20 seconds the zero-work, one-connection fixture completes 999 requests at scale 1, 997.88 at scale 1.01 and 997.5 at scale 2.5. The former 798.91 result is reproduced by deliberately reverting the fix. A scale-one reference fed at the sampled arrival instants still completes 999: arrival quantization does not explain the former 200.09-request loss. The remaining 1.12-request difference is inside the unchanged bound of 22.

The independent pooled-deadline sampling gaps remain pinned in their existing regressions.
