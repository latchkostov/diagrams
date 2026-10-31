## Current planning-upgrade persistence

The second branch Nightly's macOS planning-upgrade case immediately read a saved `p3-a1` model after clicking Upgrade, expecting `p3-w1`. The saved-copy reader can legitimately return the previous persisted edit while the current autosave is pending.

The upgrade assertion now uses the same current-autosave acknowledgement already required by quick-add naming. That small reader is shared between the two callers. The exact upgrade revision and complete-model Undo assertions remain. The paused-clock named-document regression exercises the shared reader while an older copy exists; temporarily removing its acknowledgement restores the stale-name failure. Both Windows cases pass; Linux repeats them twice. No product behavior, timeout, budget or golden changes.
