## Review follow-ups 6

- Live benchmark settling uses one expanded tail for both its median and stability bound. Recurring stalls at collector polling boundaries and a single long stall after regular frames remain unsettled.
- Seeking reads the cached current time before invalidating the snapshot, avoiding a discarded full engine snapshot on forward, backward and current-time seeks, while preserving a new continuity token for the published destination.
- Benchmark transition sampling continues until panel closure completes, even after frame recording reaches its cap. Late transition peaks are retained without extending the frame recording.
- The seek-decoration regression now applies a paused destination first and immediately checks that its idle edge clears while its active edge stays highlighted.

Negative controls restore each old implementation independently: both settle regressions fail, seek constructs two snapshots instead of one, and the late transition peak is missed. Restricting continuity clearing to moving decorations fails the new paused-first assertion. All controls are restored after checking.

No UI text or controls change. No output parity golden is changed or re-recorded. The separate engine-cost estimate follow-up remains queued for its owning branch.
