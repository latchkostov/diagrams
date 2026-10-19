## Follow-ups 13

Escape in Live's more menu returns keyboard focus to its button through the interaction controller. Shift+F10 and the ContextMenu key open the focused canvas item's context menu in Edit and Live; the no-traffic hint teaches Shift+F10 without adding controls.

Slow-motion entry flushes a pending Inputs rebuild and waits for any replay to finish before recording its checkpoint. Checks setup waits for the lazy card's actual mount before asserting visibility. The sequence-export test advances its message journey with a controlled clock instead of depending on wall-clock playback under load.

Reordered epoch pieces keep bounded roster entries with verified waiting starts until their parents resolve. Tests cover one reverse delivery, pending bounds, sealing full-capacity chain pieces with 64 recipient wraps into one frame, full diagram convergence, and recovery when a dropped sender is admitted later. The real subprocess launcher test gets a measured hang backstop: its two Vitest startups and four rejected invocations took 2.0 seconds locally; 30 seconds allows concurrent CI startup contention.

The version-mismatch message was already neutral on master; a test pins the wording. Engine behavior and bundle budgets are unchanged.

After #204 merged, this branch synced onto it. Particle hover cursor selectors now load with Live, independently of the lazy trace card. A production browser regression observes TraceCard chunk requests through idle entry and tracing; removing the cursor move or adding an eager preload makes it fail. Independent partition ownership and allocation assertions supplement #204's read-count bound at scales 1 and 10; attributing every delivery to the first group makes the new test fail.

The only changed golden is `node/i18n/catalogs.json`: the pseudo-locale's `areas.liveSession` fingerprint changes from `6d212ef4040a` to `0d66e16a4f46` for the added Shift+F10 hint. Message counts, translations, and all diagram, simulation, planning, trace and export goldens are unchanged. No golden was re-recorded for a regression.

## Verification

The unit suite passed 12,604 tests with four existing skips. Full parity matched all 2,712 goldens after the intentional catalog update (1,596 node assertions and 93 browser tests). Production build, entry/viewer size, i18n, skill freshness, lint, typecheck and formatting passed; lint retains seven existing warnings and no errors.

The affected production-browser specs passed three native repetitions: 174 passed and 12 existing Windows slow-motion quarantine skips. Five Linux load repetitions of affected specs and neighbours passed all 925 cases, with zero failures, flakes or skips. The canvas pane's new test marker required both empty-point helpers to recognize that same surface; their earlier helper failures were corrected without accepting covered points. An overlapping verification attempt was discarded and the completed runs were sequential.

The historical traffic-only slow-motion incident remains unproven; its existing browser case passes under load, while the separately demonstrated pending-rebuild race is fixed. The existing backlog entry records that distinction.
