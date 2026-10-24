## PR 280 cancellation review

Cancellation restores the entire visible gesture: nodes, boundary members and carried bends return
together, Alt-drag copies disappear, and Undo stays unchanged. The existing interaction controller
owns cancellation and rejects late events through its gesture token. No controls or chrome were added.
