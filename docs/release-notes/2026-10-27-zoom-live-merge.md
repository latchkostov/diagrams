## Zoom identity and Live refresh integration

Merge the cached Live geometry and third bundle trim into the zoom identity work. Frame detail
keeps its batched measurements, spatial indexes and dirty checks, skips hidden far-zoom label
measurements, and ignores hidden Live readout changes even when they arrive with traffic ranking
updates. Visible readouts still refresh their geometry. Zone and boundary titles retain their
flow-space anchors, and identity scaling and editing gesture guards remain intact.

Output parity verifies all 3,178 goldens with zero changes, additions, missing files or stale files.
None are re-recorded. Bundle budgets and trim reserves are unchanged.
