## Budget refusal recovery

Requested inputs remain visible while the run is stopped. The existing translated notice explains how to recover, and the existing playback controls are disabled while Restart and Inputs remain available. No new controls or toolbar items are added. A successful rebuild clears the notice and restores playback availability. Slow motion ends its failed capture without changing the paused recovery state.

Rejected partial rollback: restoring timeline cursors, credits and burst flags would create more recovery state to coordinate. An explicit restart boundary is simpler and keeps the requested settings honest. Existing lifecycle edits validated atomically before execution retain their established retry behavior.
