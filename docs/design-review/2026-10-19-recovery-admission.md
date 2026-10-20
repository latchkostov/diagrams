## Recovery admission review (PR #206, third review)

Simulation-only correctness changes. A restored caller waits for the same capacity as ordinary
admission instead of overbooking a shared allocation, and recovered continuations remain traceable.
No controls, labels, layout, focus behavior or chrome are added. The existing live readouts retain
their meanings; shared occupancy and managed execution slots now reflect actual ownership.

Reviewed against the simple-by-default, consistent-affordance and chrome-budget principles.
No new showcase is needed: this repairs existing outage/retry behavior without adding a feature.
