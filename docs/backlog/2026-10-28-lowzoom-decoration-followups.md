## Low-zoom decoration follow-ups from #378

R-79fbb677a8: skip chip health summaries and traffic decoration when chips are inactive. Preserve baseline boundary and cut-link decoration at every zoom; coordinate with the existing fault-decoration-loading follow-up and measure against the unchanged Live reserve.

R-f6cbf52bdf: add deterministic browser checks for computed failing border/tint and stressed inset accent at 40% and 25%, including recovery. The current drill test verifies decoration attributes and summary text, but cannot detect removed accent CSS.

Deferred from the five-P1 fix round because these require independent lifecycle or visual regressions. R-1b518c8dea is resolved by the shared-trunk regression at 60/120 msg/s, with an unrelated lane and all existing sampling scales.
