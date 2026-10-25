## Resolved: pooled deadlines at sampled scales

Resolved by sampling 8b. The queued burst pins now equal scale one exactly: the 600 ms pool sends three requests, times out eighteen and records one late reply; the 100 ms pool sends one request and records one late reply. The same-arrivals scale-two fixture now processes 1779 requests and scale ten processes 356, matching their scale-one references. No accuracy bound was loosened.

See [the release fragment](../release-notes/2026-10-25-sampling-deadline-cohorts.md) for the before/after table, resource semantics and parity result. Continuous source timing remains distinct from the same-arrivals comparison.
