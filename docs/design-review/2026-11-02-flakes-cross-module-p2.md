## Scope and UX review

The camera-readiness regression driver observes the camera-state assertion specifically. A canvas
lookup used to settle the viewport or pane cannot release its held camera. The new browser guard
exercises both boundaries using the real Playwright assertions. No application controls, wording,
layout, focus policy, camera behavior, saved files or simulation behavior change.

The observation adapter forwards the pinned Playwright matcher's `Locator._expect` call unchanged.
Its positive camera assertion makes a future matcher change fail explicitly rather than silently
losing coverage. Application instrumentation solely for this test is unnecessary.

## Stable timeline-note identity: defer #412 R-efb37af90f

At master a99037759, `src/tutorials/simulations.ts` still matches authored timeline steps by
time/action, then by note text. Moving and rewording one note loses its correspondence to the
reference. Neither array position nor a broader text/time heuristic can distinguish it from an
unrelated learner note.

A focused follow-up needs stable step identity through timeline edits, save, import, duplication
and reference reconstruction. Specify optional persisted identity with deterministic handling of
old files, absent IDs, duplicate IDs and copied simulations before implementing it. Reference
ownership must remain distinct from arbitrary user IDs. Preserve unrelated learner notes and
their ordering. Cover a moved/reworded startup pause and reconstruction reaching Ready; round-trip
both legacy and identified files without data loss.

That work reaches the public schema and editor correspondence contract. It cannot honestly promise
unchanged schema parity fingerprints within this test-only batch. Keep the existing deferral open;
do not add a transient identity that disappears on save/import.

## Mounted room observations: defer #402 R-fd7225032d

At the same master, `RoomLifecycle.open()` captures `currentObservationSource()` for pending-work
cancellation and later membership publication. `set()` publishes joined/left against that source,
while a ready room can mount another editor identity. Replacing it with whichever canvas is current
at publication would assign late events to an unrelated document.

The follow-up should bind observation ownership explicitly at room-editor mount, keyed by the
active room/session and mount generation. Keep the initiating source for cancellation. Unbind only
the matching generation; a stale cleanup must not clear a newer mount. Decide how a ready transition
that precedes binding is acknowledged once, and retain the bound source for the matching leave
event even if navigation already mounted another canvas.

This needs lifecycle producer, mount adapter and connected-runner changes together. Required
coverage includes admitted join across the real editor remount, leave after remount, rejected and
cancelled consent/admission, navigation while a join waits for a peer, and late completion/cleanup
after a replacement room. The existing producer-only browser observation is insufficient evidence
for tutorial step completion. Keep the existing deferral and its R-8ecc02383f coverage dependency open.
