## Reset keyboard segment selection when a route changes

Route changes clear the active segment and announce “Segment selection reset”, while keeping
the edge selected. Press ] or [ to start again at the first or last segment. A keyboard nudge
keeps its leg only if the segment structure stays unchanged; jogs and merges reset it too.
Selection no longer stores leg geometry. Stable identities across reroutes are a backlog item.

No parity goldens changed. This fix round runs targeted unit and production-browser tests;
full-suite and parity verification remain with CI.
