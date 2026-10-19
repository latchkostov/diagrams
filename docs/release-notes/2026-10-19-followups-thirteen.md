## Follow-ups 13

Escape in Live's more menu returns keyboard focus to its button through the interaction controller. Shift+F10 and the ContextMenu key open the focused canvas item's context menu in Edit and Live; the no-traffic hint teaches Shift+F10 without adding controls.

Slow-motion entry flushes a pending Inputs rebuild and waits for any replay to finish before recording its checkpoint. Checks setup waits for the lazy card's actual mount before asserting visibility. The sequence-export test advances its message journey with a controlled clock instead of depending on wall-clock playback under load.

Reordered epoch pieces keep bounded roster entries with verified waiting starts until their parents resolve. Tests cover one reverse delivery, pending bounds, sealing full-capacity chain pieces with 64 recipient wraps into one frame, full diagram convergence, and recovery when a dropped sender is admitted later. The real subprocess launcher test gets a measured hang backstop: its two Vitest startups and four rejected invocations took 2.0 seconds locally; 30 seconds allows concurrent CI startup contention.

The version-mismatch message was already neutral on master; a test pins the wording. Engine behavior and bundle budgets are unchanged.

After #204 merged, this branch synced onto it. Particle hover cursor selectors now load with Live, independently of the lazy trace card. A production browser regression observes TraceCard chunk requests through idle entry and tracing; removing the cursor move or adding an eager preload makes it fail. Independent partition ownership and allocation assertions supplement #204's read-count bound at scales 1 and 10; attributing every delivery to the first group makes the new test fail.

The only changed golden is `node/i18n/catalogs.json`: the pseudo-locale's `areas.liveSession` fingerprint changes from `6d212ef4040a` to `0d66e16a4f46` for the added Shift+F10 hint. Message counts, translations, and all diagram, simulation, planning, trace and export goldens are unchanged. No golden was re-recorded for a regression.
