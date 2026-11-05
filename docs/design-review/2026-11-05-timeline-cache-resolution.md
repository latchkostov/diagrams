## Timeline cache resolution

This fix adds no controls or copy. The existing purge target and rule fields
continue to use the effective cache configuration at the step's playback time,
including setup and preceding cache edits. Removed rules remain unresolved with
the existing field error. Other fault fields use the original topology.

The editor retains only purge choices and the selected cache table, avoiding
complete diagram snapshots when opening large imported simulations. The chrome
budget, undo behavior and progressive disclosure are unchanged.
