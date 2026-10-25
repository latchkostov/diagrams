## Collaboration diagnostics cache review

Queue changes update the existing room diagnostics immediately, keeping join and recovery state
consistent for subscribers. There are no new controls, text, layout changes or settings. The fix
preserves snapshot identity for unrelated activity and introduces no time-based cache expiry.
