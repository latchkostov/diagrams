## Cause

Round-five Nightly 41276976443, macOS shard 9, reads the newly created node from storage immediately after typing and Escape. The first creation save contains Redis Cache; the named revision has not yet acknowledged its autosave. The existing current-document reader already guards this distinction elsewhere in the spec.

## Repair and regression

Use that reader for the navigation-and-naming case's final snapshot, retaining the exact Cache audit assertion and complete node/edge checks. The existing held-autosave regression passes with the reader and fails on Windows with the old reader temporarily restored: expected Cache audit, received Redis Cache. All three affected Windows cases pass. Native macOS confirmation belongs to the branch Nightly; an isolated Windows pass does not establish the native failure rate.

No product behavior, timeout, tolerance, budget, skip or golden changes. Reading any persisted node after creation is insufficient evidence that naming has saved.

## Verification

Production build, entry/viewer size checks and all 30 startup/reserve heavy tests pass. Full output parity passes without re-recording any golden. Final lint, typecheck and both repository-wide formatting commands precede the signed commit. Linux repetitions and the dispatched native table are recorded in the round-six verification fragment.
