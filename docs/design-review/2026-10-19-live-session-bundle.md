## Live session bundle review

The trace card appears only after a tracing action, so its implementation can download on demand.
The existing lazy component helper handles loading and offers a retry toast on download failure.
There are no new controls, text, or changes to card layout, focus policy, or simulation behavior.

The invariant oracle already has no production runtime import. Checkpoints remain synchronous because
playback and seeking use them; the inspected slot-clock helpers still have callers. Changing those paths
would introduce unnecessary simulation risk for this bundle repair. The trace card split provides
2,853 B of budget headroom after syncing with master, with one production import change.
