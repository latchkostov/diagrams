## Live cache footprint

Compact the Live geometry cache and worker bookkeeping to preserve the third trim's Live
reserve. Shared attribute lists and one observer setup remove duplication; a dirty-group
set replaces separate style and march invalidation flags. The cache and worker use native
private fields so the production minifier can shorten their internal names. Geometry-only
updates still reuse computed styles, and unchanged ticks do no geometry or style reads.

The worker still waits for the current geometry acknowledgement before revealing trace
labels. No controls, simulation behavior, budgets or reserves change. Output parity checks
3,178 goldens with zero changes, additions, missing files or stale files; none are re-recorded.

## Verification

The same-base local production Live comparison falls from 129,009 B gzip to 128,677 B,
saving 332 B. After syncing with master `aa6a4090b`, the payload is 128,675 B, leaving 181 B
under the unchanged 128,856 B third-trim ceiling. Temporarily restoring the original scene and
worker makes that reserve test fail again at 129,009 B; all 28 bundle tests pass with the fix.
The production build and entry, locale, viewer and Forge size checks also pass.

Live and routing browser coverage passes 240 cases across two repetitions. One Live unit
case hits the existing timeout backstop in the suite and first isolated run; the final
isolated decoration spec passes all 13 cases. No assertions or timeouts change.

The routing focus case passes five consecutive production-build runs on this branch and five
on clean master `6dd721901`. A fresh five-run check of clean master `aa6a4090b` reproduces the
CI signature once: the first new-route form is missing at `toBeFocused` (four passed, one
failed). Routing remains unchanged; the evidence is recorded in the routing-mix-form-focus
backlog fragment.
