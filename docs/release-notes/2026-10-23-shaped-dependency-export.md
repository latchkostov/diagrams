## Shaped dependency image exports

Image export now waits for dependency details that appear after a hand-shaped edge's geometry loads. Exported images keep the dependency glyph even when the geometry and details chunks arrive separately. The existing export cancellation and timeout still apply.

Output parity passed all 3,146 goldens unchanged: zero changed, added, missing, or stale. No goldens are updated.
