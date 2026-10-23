## Lazy recovery and message-type polish

Slow motion keeps its replay status visible while the readout downloads. Saved-simulation scrubbers load on demand and use the shared Retry toast after a failed download. Escape and keyboard focus remain available while either download is held.

Both Lab canvas hosts now show the same carried-message hover and focus reader as the editor. The inspector's Carries list renders at most 100 chips and counts the rest. Tooltip overflow text refreshes when the language changes, and an open type picker keeps its highlighted type when deferred propagation refreshes its choices.

Message-loop findings budget the unique element IDs they actually emit instead of repeated traversal occurrences. Normal Checks no longer record verification graphs for the quarantined automatic loop fixer; explicit verification callers can still request them on demand.

No bundle budget was raised. Output parity: all 3,111 goldens are unchanged (0 added, missing or stale); no loop-finding golden needed an update. After sync, the bundle measured 379,309 bytes for canvas first view against the unchanged 383,000-byte budget.

The saved-simulation lazy loader also landed on master in #255 during this batch. Sync preserves its loading placeholder. Its scrubber and expectation indicators now share one lazy boundary so a single Retry recovers both; separate boundaries could let the indicators' Retry leave the scrubber failed.
