## PR #312 round 1 follow-ups

- **R-a151abeabd / R-97a9c27cda — Defer vocabulary normalization.** Empty-query node pickers recreate choice arrays and repeatedly lowercase the same vocabulary across visible rows. Normalize only for a nonempty search or share stable vocabulary indexes; add operation-count coverage for fresh arrays and assert empty searches never lowercase names.
- **R-00d6efe51e — Preserve every positive traffic-mix route in deduplication coverage.** Add distinct request-filtered destinations for positive routes, plus zero-rate routes. Assert every positive destination carries the injected type, zero-rate destinations stay empty, and repeated inputs preserve those results. The existing aggregate type-set assertion cannot distinguish expansion of only the first route.

These P2s are queued separately from the scoped diagnostics and search-feedback corrections in this fix round. Keep existing propagation budgets and assertions.
