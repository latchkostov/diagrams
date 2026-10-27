## Live worker geometry acknowledgment

Reviewed against the no-overlap and presentation rules: stale trace labels stay hidden while card
detail geometry changes, and the current frame restores them even while paused. No new controls,
text or chrome. Tests retain the old-ack and repaint checks and verify unchanged frames stop
posting once the current geometry is acknowledged.
