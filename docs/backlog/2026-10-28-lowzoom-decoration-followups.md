## Low-zoom decoration follow-ups from #378

R-79fbb677a8: skip chip health summaries and traffic decoration when chips are inactive. Preserve baseline boundary and cut-link decoration at every zoom; coordinate with the existing fault-decoration-loading follow-up and measure against the unchanged Live reserve.

R-f6cbf52bdf is resolved by computed border, tint and inset-accent checks at 40% and 25%, including recovery, in `lowzoom-review.spec.ts`.

The remaining R-79fbb677a8 changes a shared decoration lifecycle used by baseline fault ink and capture/export restoration. Keep it as a separate change with mode-transition and capture regressions; the small visual checks do not establish that lifecycle contract. R-1b518c8dea is resolved by the shared-trunk regression at 60/120 msg/s, with an unrelated lane and all existing sampling scales.
