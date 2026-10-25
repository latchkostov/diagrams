## PR #312 round 1 follow-ups

- **RESOLVED R-a151abeabd / R-97a9c27cda — Defer vocabulary normalization.** Normalization now starts with a nonempty searchable query. Fresh-array call counts prove empty-query pickers never lowercase names, and search call counts prove vocabulary reuse.
- **RESOLVED R-00d6efe51e — Preserve every positive traffic-mix route in deduplication coverage.** Distinct request-filtered destinations assert both positive routes and no zero-rate deliveries for repeated inputs and saved runs sharing the cached mix. Unique saved-run types prevent free play from masking failures. Existing operation-growth proofs remain unchanged.

Resolved in the P2 message types and example discovery follow-ups. Existing propagation budgets and assertions remain unchanged; visible diagram-scope diagnostics stay quarantined.
